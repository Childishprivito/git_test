//! Open Food Facts lookups (free, no API key): https://world.openfoodfacts.org

use foodlog_core::{model::Food, off::parse_product};
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
