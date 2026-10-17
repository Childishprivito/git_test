//! Turning USDA FoodData Central search results into `Food`s.
//! API docs: https://fdc.nal.usda.gov/api-guide

use crate::{model::Food, off::num};
use serde_json::Value;

/// Find a nutrient by its USDA number (e.g. "208" = calories).
fn nutrient(food: &Value, numbers: &[&str]) -> Option<f64> {
    let list = food["foodNutrients"].as_array()?;
    numbers.iter().find_map(|n| {
        list.iter()
            .find(|x| x["nutrientNumber"].as_str() == Some(n))
            .and_then(|x| num(&x["value"]))
    })
}

/// "CHOBANI GREEK YOGURT" -> "Chobani Greek Yogurt" (USDA brand data is often all caps).
fn tidy(s: &str) -> String {
    let s = s.trim();
    if s.chars().any(|c| c.is_lowercase()) {
        return s.to_string();
    }
    s.split(' ')
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + &c.as_str().to_lowercase(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// One search result. Values from the search API are per 100 g.
pub fn parse_food(f: &Value) -> Option<Food> {
    let name = tidy(f["description"].as_str()?);
    let kcal = nutrient(f, &["208", "957", "958"])
        .or_else(|| nutrient(f, &["268"]).map(|kj| kj / 4.184))?;
    let unit = f["servingSizeUnit"].as_str().unwrap_or("").to_lowercase();
    let serving_g = num(&f["servingSize"])
        .filter(|_| matches!(unit.as_str(), "g" | "grm" | "ml" | "mlt"))
        .or_else(|| {
            f["foodMeasures"]
                .as_array()?
                .iter()
                .find_map(|m| num(&m["gramWeight"]))
        })
        .filter(|g| *g > 0.0);
    let upc = f["gtinUpc"].as_str().filter(|s| !s.is_empty());
    Some(Food {
        id: match upc {
            Some(code) => code.to_string(),
            None => format!("usda-{}", f["fdcId"].as_i64().unwrap_or(0)),
        },
        name,
        brand: tidy(
            f["brandName"]
                .as_str()
                .or(f["brandOwner"].as_str())
                .unwrap_or(""),
        ),
        kcal,
        protein: nutrient(f, &["203"]).unwrap_or(0.0),
        carbs: nutrient(f, &["205"]).unwrap_or(0.0),
        fat: nutrient(f, &["204"]).unwrap_or(0.0),
        serving_g,
        custom: false,
    })
}

pub fn parse_search(json: &Value) -> Vec<Food> {
    json["foods"]
        .as_array()
        .map(|fs| fs.iter().filter_map(parse_food).collect())
        .unwrap_or_default()
}

/// Barcodes are printed with or without leading zeros; compare them without.
pub fn same_barcode(a: &str, b: &str) -> bool {
    let (a, b) = (a.trim_start_matches('0'), b.trim_start_matches('0'));
    !a.is_empty() && a == b
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_generic_food() {
        let r = json!({"foods": [{
            "fdcId": 173944, "description": "Bananas, raw", "dataType": "SR Legacy",
            "foodNutrients": [
                {"nutrientNumber": "208", "unitName": "KCAL", "value": 89},
                {"nutrientNumber": "203", "value": 1.09},
                {"nutrientNumber": "205", "value": 22.8},
                {"nutrientNumber": "204", "value": 0.33}
            ],
            "foodMeasures": [{"disseminationText": "1 medium", "gramWeight": 118}]
        }]});
        let f = &parse_search(&r)[0];
        assert_eq!(f.id, "usda-173944");
        assert_eq!(f.kcal, 89.0);
        assert_eq!(f.carbs, 22.8);
        assert_eq!(f.serving_g, Some(118.0));
    }

    #[test]
    fn parses_branded_food_with_barcode() {
        let f = parse_food(&json!({
            "fdcId": 1, "description": "NONFAT GREEK YOGURT", "dataType": "Branded",
            "brandOwner": "CHOBANI", "gtinUpc": "818290014269",
            "servingSize": 150, "servingSizeUnit": "GRM",
            "foodNutrients": [{"nutrientNumber": "208", "value": 53}, {"nutrientNumber": "203", "value": 10}]
        }))
        .unwrap();
        assert_eq!(f.id, "818290014269");
        assert_eq!(f.name, "Nonfat Greek Yogurt");
        assert_eq!(f.brand, "Chobani");
        assert_eq!(f.serving_g, Some(150.0));
    }

    #[test]
    fn barcodes_match_without_leading_zeros() {
        assert!(same_barcode("0818290014269", "818290014269"));
        assert!(!same_barcode("000", "0"));
    }
}
