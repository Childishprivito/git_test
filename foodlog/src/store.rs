//! Saving to and loading from the phone's local storage.

use crate::model::Db;

const KEY: &str = "foodlog.v1";

fn storage() -> Option<web_sys::Storage> {
    web_sys::window()?.local_storage().ok().flatten()
}

pub fn load() -> Db {
    storage()
        .and_then(|s| s.get_item(KEY).ok().flatten())
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

pub fn save(db: &Db) {
    if let (Some(s), Ok(json)) = (storage(), serde_json::to_string(db)) {
        let _ = s.set_item(KEY, &json);
    }
}

/// Today's local date as `YYYY-MM-DD`, shifted by `offset_days`.
pub fn date_string(offset_days: i32) -> String {
    let now = js_sys::Date::new_0();
    // JS normalises day overflow (e.g. day 0 = last day of previous month).
    let d = js_sys::Date::new_with_year_month_day(
        now.get_full_year(),
        now.get_month() as i32,
        now.get_date() as i32 + offset_days,
    );
    format!(
        "{:04}-{:02}-{:02}",
        d.get_full_year(),
        d.get_month() + 1,
        d.get_date()
    )
}

pub fn current_hour() -> u32 {
    js_sys::Date::new_0().get_hours()
}

pub fn now_ms() -> u64 {
    js_sys::Date::now() as u64
}
