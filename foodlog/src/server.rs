//! Talking to the FoodLog server (the Cloudflare Worker in `foodlog-worker/`).
//! The address and password live only on this device, outside the synced log.

use foodlog_core::{
    estimate::{Estimate, EstimateRequest},
    model::{Db, Food},
};
use gloo_net::http::{Request, Response};
use serde::{Deserialize, Serialize, de::DeserializeOwned};

const KEY: &str = "foodlog.server";

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Config {
    pub url: String,
    pub password: String,
}

fn storage() -> Option<web_sys::Storage> {
    web_sys::window()?.local_storage().ok().flatten()
}

/// `None` until the server is set up in Settings.
pub fn config() -> Option<Config> {
    let c: Config = serde_json::from_str(&storage()?.get_item(KEY).ok()??).ok()?;
    (!c.url.is_empty() && !c.password.is_empty()).then_some(c)
}

pub fn save_config(c: &Config) {
    if let Some(s) = storage() {
        let _ = s.set_item(KEY, &serde_json::to_string(c).unwrap_or_default());
    }
}

fn url(c: &Config, path: &str) -> String {
    format!("{}{path}", c.url.trim().trim_end_matches('/'))
}

async fn read<T: DeserializeOwned>(resp: Result<Response, gloo_net::Error>) -> Result<T, String> {
    let resp = resp.map_err(|_| "Can't reach your FoodLog server. Are you online?".to_string())?;
    if resp.ok() {
        return resp
            .json::<T>()
            .await
            .map_err(|_| "Unexpected reply from the server.".to_string());
    }
    #[derive(Deserialize)]
    struct Err {
        error: String,
    }
    Err(match resp.json::<Err>().await {
        Ok(e) => e.error,
        Err(_) => format!("Server error ({}).", resp.status()),
    })
}

async fn post<B: Serialize, T: DeserializeOwned>(path: &str, body: &B) -> Result<T, String> {
    let c = config().ok_or("Set up your server in Settings first.")?;
    let req = Request::post(&url(&c, path))
        .header("Authorization", &format!("Bearer {}", c.password))
        .json(body)
        .map_err(|e| e.to_string())?;
    read(req.send().await).await
}

/// Send this device's log; get back the merged log from all devices.
pub async fn sync(db: &Db) -> Result<Db, String> {
    post("/sync", db).await
}

pub async fn estimate(req: &EstimateRequest) -> Result<Estimate, String> {
    post("/estimate", req).await
}

/// USDA search. With `upc`, only foods with that barcode come back.
pub async fn usda(query: &str, upc: bool) -> Result<Vec<Food>, String> {
    let c = config().ok_or("No server set up.")?;
    let q = String::from(js_sys::encode_uri_component(query));
    let path = if upc {
        format!("/usda?upc={q}")
    } else {
        format!("/usda?q={q}")
    };
    let req =
        Request::get(&url(&c, &path)).header("Authorization", &format!("Bearer {}", c.password));
    read(req.send().await).await
}
