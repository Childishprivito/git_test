//! Open Food Facts lookups (free, no API key): https://world.openfoodfacts.org

use crate::model::Food;
use serde_json::Value;

const BASE: &str = "https://world.openfoodfacts.org";
const FIELDS: &str = "code,product_name,product_name_en,brands,nutriments,serving_quantity";

/// Look up a barcode. `Ok(None)` means Open Food Facts doesn't know it.
pub async fn lookup(barcode: &str) -> Result<Option<Food>, String> {
    let mut candidates = vec![barcode.to_string()];
    // US UPC-A codes (12 digits) are often stored as EAN-13 with a leading 0.
    if barcode.len() == 12 {
        candidates.push(format!("0{barcode}"));
    }
    for code in candidates {
        let url = format!("{BASE}/api/v2/product/{code}.json?fields={FIELDS}");
        let json = get_json(&url).await?;
        if json["status"].as_i64() == Some(1) {
            if let Some(food) = parse_product(&json["product"], barcode) {
                return Ok(Some(food));
            }
        }
    }
    Ok(None)
}

/// Search by name. Results are sorted by how often people scan them.
pub async fn search(query: &str) -> Result<Vec<Food>, String> {
    let q = String::from(js_sys::encode_uri_component(query));
    let url = format!(
        "{BASE}/cgi/search.pl?search_terms={q}&search_simple=1&action=process&json=1\
         &page_size=25&sort_by=unique_scans_n&fields={FIELDS}"
    );
    let json = get_json(&url).await?;
    Ok(json["products"]
        .as_array()
        .map(|ps| ps.iter().filter_map(|p| parse_product(p, "")).collect())
        .unwrap_or_default())
}

async fn get_json(url: &str) -> Result<Value, String> {
    let resp = gloo_net::http::Request::get(url)
        .send()
        .await
        .map_err(|_| "Couldn't reach Open Food Facts. Check your connection.".to_string())?;
    if resp.status() >= 500 {
        return Err("Open Food Facts is having trouble. Try again in a minute.".into());
    }
    resp.json::<Value>()
        .await
        .map_err(|_| "Unexpected reply from Open Food Facts.".to_string())
}

/// Numbers in Open Food Facts are sometimes strings, so accept both.
fn num(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

/// Turn one Open Food Facts product into a `Food` (per 100 g).
/// Returns `None` if it has no name or no calorie info.
pub fn parse_product(p: &Value, fallback_code: &str) -> Option<Food> {
    let name = [&p["product_name_en"], &p["product_name"]]
        .iter()
        .filter_map(|v| v.as_str())
        .map(str::trim)
        .find(|s| !s.is_empty())?
        .to_string();
    let n = &p["nutriments"];
    let serving_g = num(&p["serving_quantity"]).filter(|g| *g > 0.0);

    // Prefer per-100 g values; fall back to per-serving values scaled up.
    let get = |key: &str| -> Option<f64> {
        num(&n[format!("{key}_100g")])
            .or_else(|| Some(num(&n[format!("{key}_serving")])? * 100.0 / serving_g?))
    };
    let kcal = get("energy-kcal").or_else(|| get("energy").map(|kj| kj / 4.184))?;

    let code = p["code"]
        .as_str()
        .filter(|c| !c.is_empty())
        .unwrap_or(fallback_code);
    Some(Food {
        id: code.to_string(),
        name,
        brand: p["brands"]
            .as_str()
            .unwrap_or("")
            .split(',')
            .next()
            .unwrap_or("")
            .trim()
            .to_string(),
        kcal,
        protein: get("proteins").unwrap_or(0.0),
        carbs: get("carbohydrates").unwrap_or(0.0),
        fat: get("fat").unwrap_or(0.0),
        serving_g,
        custom: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_per_100g_product() {
        let p = json!({
            "code": "049000028911",
            "product_name": "Diet Coke",
            "brands": "Coca-Cola, The Coca-Cola Company",
            "serving_quantity": "355",
            "nutriments": { "energy-kcal_100g": 0.4, "proteins_100g": 0, "carbohydrates_100g": "0", "fat_100g": 0 }
        });
        let f = parse_product(&p, "").unwrap();
        assert_eq!(f.name, "Diet Coke");
        assert_eq!(f.brand, "Coca-Cola");
        assert_eq!(f.serving_g, Some(355.0));
        assert_eq!(f.kcal, 0.4);
    }

    #[test]
    fn scales_per_serving_values_and_converts_kj() {
        let p = json!({
            "product_name": "Bar",
            "serving_quantity": 50,
            "nutriments": { "energy_serving": 1046, "proteins_serving": 10 }
        });
        let f = parse_product(&p, "123").unwrap();
        assert_eq!(f.id, "123");
        assert!((f.kcal - 500.0).abs() < 0.1); // 1046 kJ/50 g -> ~500 kcal/100 g
        assert_eq!(f.protein, 20.0);
    }

    #[test]
    fn rejects_products_without_calories() {
        let p = json!({ "product_name": "Mystery", "nutriments": {} });
        assert!(parse_product(&p, "").is_none());
    }
}
