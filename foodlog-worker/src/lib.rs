//! FoodLog server. Endpoints (all need `Authorization: Bearer <APP_PASSWORD>`):
//!
//! - `POST /sync`     body: the app's whole log. Merges it with the saved copy,
//!                    saves the result and returns it.
//! - `POST /estimate` body: `{text, image?}`. Asks Claude for nutrition facts.
//! - `GET  /usda?q=…` searches USDA FoodData Central (add `&upc=…` to match a barcode).

use foodlog_core::{
    estimate::{self, EstimateRequest},
    model::Db,
    usda,
};
use serde_json::{Value, json};
use worker::*;

const DB_KEY: &str = "db";

#[event(fetch)]
async fn fetch(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    let origin = req.headers().get("Origin")?.unwrap_or_default();
    let allowed = env
        .var("ALLOWED_ORIGINS")
        .map(|v| v.to_string())
        .unwrap_or_default()
        .split(',')
        .any(|o| o.trim() == origin);

    let resp = if req.method() == Method::Options {
        Response::empty()
    } else if !authorized(&req, &env) {
        error(
            401,
            "Wrong password. Check it in the app under Settings › Sync & AI.",
        )
    } else {
        route(req, env)
            .await
            .or_else(|e| error(500, &format!("Server error: {e}")))
    };

    let mut resp = resp?;
    if allowed {
        let h = resp.headers_mut();
        h.set("Access-Control-Allow-Origin", &origin)?;
        h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")?;
        h.set(
            "Access-Control-Allow-Headers",
            "Authorization, Content-Type",
        )?;
        h.set("Access-Control-Max-Age", "86400")?;
        h.set("Vary", "Origin")?;
    }
    Ok(resp)
}

async fn route(mut req: Request, env: Env) -> Result<Response> {
    let path = req.path();
    match (req.method(), path.as_str()) {
        (Method::Post, "/sync") => {
            let incoming: Db = match req.json().await {
                Ok(db) => db,
                Err(_) => return error(400, "That isn't a FoodLog log."),
            };
            let kv = env.kv("FOODLOG")?;
            let saved: Db = kv.get(DB_KEY).json().await?.unwrap_or_default();
            let merged = saved.merge(&incoming);
            if merged != saved {
                kv.put(DB_KEY, serde_json::to_string(&merged)?)?
                    .execute()
                    .await?;
            }
            Response::from_json(&merged)
        }
        (Method::Post, "/estimate") => {
            let body: EstimateRequest = match req.json().await {
                Ok(b) => b,
                Err(_) => return error(400, "Send a description or a photo."),
            };
            if body.text.trim().is_empty() && body.image.is_none() {
                return error(400, "Send a description or a photo.");
            }
            match ask_claude(&env, &body).await? {
                Ok(est) => Response::from_json(&est),
                Err(msg) => error(502, &msg),
            }
        }
        (Method::Get, "/usda") => {
            let url = req.url()?;
            let param = |k: &str| {
                url.query_pairs()
                    .find(|(n, _)| n == k)
                    .map(|(_, v)| v.to_string())
            };
            let upc = param("upc");
            let Some(q) = param("q").or(upc.clone()).filter(|q| !q.trim().is_empty()) else {
                return error(400, "Missing search words.");
            };
            let mut foods = usda_search(&env, &q).await?;
            if let Some(code) = upc {
                foods.retain(|f| usda::same_barcode(&f.id, &code));
            }
            Response::from_json(&foods)
        }
        _ => error(404, "Not found."),
    }
}

fn error(status: u16, msg: &str) -> Result<Response> {
    Ok(Response::from_json(&json!({ "error": msg }))?.with_status(status))
}

/// Constant-time password check.
fn authorized(req: &Request, env: &Env) -> bool {
    let Ok(expected) = env.secret("APP_PASSWORD").map(|s| s.to_string()) else {
        return false;
    };
    let given = req
        .headers()
        .get("Authorization")
        .ok()
        .flatten()
        .and_then(|h| h.strip_prefix("Bearer ").map(str::to_string))
        .unwrap_or_default();
    !expected.is_empty()
        && given.len() == expected.len()
        && given
            .bytes()
            .zip(expected.bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
}

async fn post_json(url: &str, headers: Headers, body: &Value) -> Result<(u16, Value)> {
    headers.set("Content-Type", "application/json")?;
    let mut init = RequestInit::new();
    init.with_method(Method::Post)
        .with_headers(headers)
        .with_body(Some(serde_json::to_string(body)?.into()));
    let mut resp = Fetch::Request(Request::new_with_init(url, &init)?)
        .send()
        .await?;
    let status = resp.status_code();
    let json = resp.json::<Value>().await.unwrap_or(Value::Null);
    Ok((status, json))
}

/// Outer `Result` = server problem; inner = a message to show in the app.
async fn ask_claude(
    env: &Env,
    req: &EstimateRequest,
) -> Result<std::result::Result<estimate::Estimate, String>> {
    let key = env.secret("ANTHROPIC_API_KEY")?.to_string();
    let model = env
        .var("MODEL")
        .map(|v| v.to_string())
        .unwrap_or_else(|_| "claude-opus-5-5".into());
    let headers = Headers::new();
    headers.set("x-api-key", &key)?;
    headers.set("anthropic-version", "2023-06-01")?;
    headers.set("anthropic-beta", "server-side-fallback-2026-07-01")?;
    let base = env
        .var("ANTHROPIC_BASE_URL")
        .map(|v| v.to_string())
        .unwrap_or_else(|_| "https://api.anthropic.com".into());
    let (status, resp) = post_json(
        &format!("{base}/v1/messages"),
        headers,
        &estimate::claude_request(&model, req),
    )
    .await?;
    Ok(match status {
        200 => estimate::parse_claude_response(&resp),
        401 | 403 => {
            Err("The server's Anthropic API key isn't working. Check it in Cloudflare.".into())
        }
        402 => Err("Your Anthropic account is out of credit.".into()),
        429 | 529 => Err("The AI is busy right now. Try again in a minute.".into()),
        _ => {
            console_error!("Claude API {status}: {resp}");
            Err(format!("The AI request failed ({status})."))
        }
    })
}

async fn usda_search(env: &Env, query: &str) -> Result<Vec<foodlog_core::model::Food>> {
    let key = env
        .secret("USDA_API_KEY")
        .map(|s| s.to_string())
        .unwrap_or_else(|_| "DEMO_KEY".into());
    let base = env
        .var("USDA_BASE_URL")
        .map(|v| v.to_string())
        .unwrap_or_else(|_| "https://api.nal.usda.gov".into());
    let url = format!("{base}/fdc/v1/foods/search?api_key={key}");
    let body = json!({
        "query": query,
        "pageSize": 25,
        "dataType": ["Foundation", "SR Legacy", "Survey (FNDDS)", "Branded"]
    });
    let (status, resp) = post_json(&url, Headers::new(), &body).await?;
    if status != 200 {
        console_error!("USDA {status}: {resp}");
        return Ok(Vec::new());
    }
    Ok(usda::parse_search(&resp))
}
