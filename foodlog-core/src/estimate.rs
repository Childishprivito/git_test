//! AI nutrition estimates: what the app sends, what Claude must answer,
//! and turning the answer into a `Food`.

use crate::model::Food;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Image {
    /// e.g. "image/jpeg"
    pub media_type: String,
    /// Base64, no `data:` prefix.
    pub data: String,
}

/// App -> server.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct EstimateRequest {
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub image: Option<Image>,
}

/// Claude -> server -> app. Numbers are for one serving as described.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Estimate {
    /// Product name as printed, without the brand.
    pub name: String,
    /// Brand as printed on the package, or "".
    #[serde(default)]
    pub brand: String,
    /// What to type into a food database to find this product, or "" if it isn't packaged.
    #[serde(default)]
    pub search_query: String,
    pub serving_description: String,
    pub serving_g: f64,
    pub kcal: f64,
    pub protein_g: f64,
    pub carbs_g: f64,
    pub fat_g: f64,
    /// "high" (read from a label), "medium" or "low" (guessed from a photo or description).
    pub confidence: String,
    pub notes: String,
}

impl Estimate {
    pub fn to_food(&self, id: String) -> Food {
        let g = if self.serving_g > 0.0 {
            self.serving_g
        } else {
            100.0
        };
        let per100 = |v: f64| v.max(0.0) * 100.0 / g;
        Food {
            id,
            name: self.name.clone(),
            brand: self.brand.clone(),
            kcal: per100(self.kcal),
            protein: per100(self.protein_g),
            carbs: per100(self.carbs_g),
            fat: per100(self.fat_g),
            serving_g: Some(g),
            serving_label: None,
            custom: true,
        }
    }
}

pub const SYSTEM_PROMPT: &str = "You identify foods from photos for a personal calorie-tracking app. \
The photo is usually the front of a packaged food. It may instead show a nutrition facts label or a plate of food.\n\
- name: the product name as printed, without the brand (e.g. \"Vanilla Skyr\"). For unpackaged food, a short specific name.\n\
- brand: the brand exactly as printed, or \"\" if none is visible.\n\
- search_query: brand plus product name as you'd type it into a food database search \
(e.g. \"Siggi's vanilla skyr\"), or \"\" if it isn't a packaged product.\n\
- Nutrition is for one serving. If a nutrition label is visible, copy it exactly and set confidence to \"high\". \
Otherwise use what you know about this product's label (\"medium\"), or estimate a realistic portion (\"low\").\n\
- serving_g is the serving's weight in grams (use ml as grams for drinks).\n\
- serving_description says what the serving is, like \"1 cup (150 g)\".\n\
- notes is one short sentence on what you read or assumed. If the photo isn't food, give zeros and say so in notes.";

/// JSON schema for structured output (every object closed, every field required).
pub fn schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "brand": {"type": "string"},
            "search_query": {"type": "string"},
            "serving_description": {"type": "string"},
            "serving_g": {"type": "number"},
            "kcal": {"type": "number"},
            "protein_g": {"type": "number"},
            "carbs_g": {"type": "number"},
            "fat_g": {"type": "number"},
            "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
            "notes": {"type": "string"}
        },
        "required": ["name", "brand", "search_query", "serving_description", "serving_g", "kcal", "protein_g", "carbs_g", "fat_g", "confidence", "notes"],
        "additionalProperties": false
    })
}

/// Body for `POST https://api.anthropic.com/v1/messages`.
pub fn claude_request(model: &str, req: &EstimateRequest) -> Value {
    let mut content = Vec::new();
    if let Some(img) = &req.image {
        content.push(json!({
            "type": "image",
            "source": {"type": "base64", "media_type": img.media_type, "data": img.data}
        }));
    }
    let text = if req.text.trim().is_empty() {
        "What food is this? Identify it and estimate its nutrition."
    } else {
        req.text.trim()
    };
    content.push(json!({"type": "text", "text": text}));
    json!({
        "model": model,
        "max_tokens": 16000,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": content}],
        "output_config": {"effort": "medium", "format": {"type": "json_schema", "schema": schema()}},
        // If a safety check declines, let the API retry on its recommended fallback model.
        "fallbacks": "default"
    })
}

/// Pull the estimate out of a Messages API response.
pub fn parse_claude_response(resp: &Value) -> Result<Estimate, String> {
    match resp["stop_reason"].as_str() {
        Some("refusal") => return Err("The AI declined to estimate that.".into()),
        Some("max_tokens") => return Err("The AI's answer was cut off. Try again.".into()),
        _ => {}
    }
    let text = resp["content"]
        .as_array()
        .and_then(|blocks| blocks.iter().rev().find(|b| b["type"] == "text"))
        .and_then(|b| b["text"].as_str())
        .ok_or("The AI sent back no answer.")?;
    serde_json::from_str(text)
        .map_err(|_| "The AI's answer wasn't in the expected format.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_has_image_before_text_and_schema() {
        let r = claude_request(
            "claude-opus-5-5",
            &EstimateRequest {
                text: "2 slices pepperoni pizza".into(),
                image: Some(Image {
                    media_type: "image/jpeg".into(),
                    data: "AAA".into(),
                }),
            },
        );
        let content = r["messages"][0]["content"].as_array().unwrap();
        assert_eq!(content[0]["type"], "image");
        assert_eq!(content[1]["text"], "2 slices pepperoni pizza");
        assert_eq!(r["output_config"]["format"]["type"], "json_schema");
        assert_eq!(
            r["output_config"]["format"]["schema"]["additionalProperties"],
            false
        );
    }

    #[test]
    fn parses_answer_after_thinking_block() {
        let resp = json!({
            "stop_reason": "end_turn",
            "content": [
                {"type": "thinking", "thinking": ""},
                {"type": "text", "text": "{\"name\":\"Pepperoni pizza\",\"brand\":\"\",\"search_query\":\"\",\"serving_description\":\"2 slices\",\"serving_g\":220,\"kcal\":620,\"protein_g\":26,\"carbs_g\":70,\"fat_g\":26,\"confidence\":\"medium\",\"notes\":\"Assumed large slices.\"}"}
            ]
        });
        let e = parse_claude_response(&resp).unwrap();
        assert_eq!(e.kcal, 620.0);
        let f = e.to_food("custom-1".into());
        assert!((f.kcal - 281.8).abs() < 0.1);
        assert_eq!(f.serving_g, Some(220.0));
    }

    #[test]
    fn schema_asks_for_brand_and_search_query() {
        let req = schema()["required"].clone();
        assert!(req.as_array().unwrap().iter().any(|v| v == "search_query"));
        assert!(req.as_array().unwrap().iter().any(|v| v == "brand"));
    }

    #[test]
    fn refusal_is_an_error() {
        assert!(parse_claude_response(&json!({"stop_reason": "refusal", "content": []})).is_err());
    }
}
