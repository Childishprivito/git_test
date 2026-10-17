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
    pub name: String,
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
            brand: String::new(),
            kcal: per100(self.kcal),
            protein: per100(self.protein_g),
            carbs: per100(self.carbs_g),
            fat: per100(self.fat_g),
            serving_g: Some(g),
            custom: true,
        }
    }
}

pub const SYSTEM_PROMPT: &str = "You estimate nutrition facts for a personal calorie-tracking app. \
The user describes something they ate and may attach a photo.\n\
- If the photo shows a nutrition facts label, copy its per-serving values exactly and set confidence to \"high\".\n\
- If the photo shows a meal or the user only describes it, estimate a realistic portion and its nutrition \
using typical recipes and restaurant data; set confidence to \"medium\" or \"low\".\n\
- If the user names a quantity (\"2 slices\", \"large\"), the serving is that whole quantity.\n\
- serving_g is the total weight of the serving in grams (use ml as grams for drinks).\n\
- name is short and specific, like \"Chipotle chicken burrito bowl\".\n\
- serving_description says what the serving is, like \"1 bowl (about 650 g)\".\n\
- notes is one short sentence on what you assumed. If the input isn't food, give zeros and say so in notes.";

/// JSON schema for structured output (every object closed, every field required).
pub fn schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "serving_description": {"type": "string"},
            "serving_g": {"type": "number"},
            "kcal": {"type": "number"},
            "protein_g": {"type": "number"},
            "carbs_g": {"type": "number"},
            "fat_g": {"type": "number"},
            "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
            "notes": {"type": "string"}
        },
        "required": ["name", "serving_description", "serving_g", "kcal", "protein_g", "carbs_g", "fat_g", "confidence", "notes"],
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
        "Estimate the nutrition for what's in this photo."
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
                {"type": "text", "text": "{\"name\":\"Pepperoni pizza\",\"serving_description\":\"2 slices\",\"serving_g\":220,\"kcal\":620,\"protein_g\":26,\"carbs_g\":70,\"fat_g\":26,\"confidence\":\"medium\",\"notes\":\"Assumed large slices.\"}"}
            ]
        });
        let e = parse_claude_response(&resp).unwrap();
        assert_eq!(e.kcal, 620.0);
        let f = e.to_food("custom-1".into());
        assert!((f.kcal - 281.8).abs() < 0.1);
        assert_eq!(f.serving_g, Some(220.0));
    }

    #[test]
    fn refusal_is_an_error() {
        assert!(parse_claude_response(&json!({"stop_reason": "refusal", "content": []})).is_err());
    }
}
