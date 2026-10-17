//! Plain data types for foods, diary entries and goals.

use serde::{Deserialize, Serialize};

use crate::workout::{LoggedSet, Program};

/// Nutrition facts, always stored per 100 g so amounts are easy to scale.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Food {
    /// Barcode for scanned foods, or `custom-<timestamp>` for hand-entered ones.
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub brand: String,
    pub kcal: f64,
    pub protein: f64,
    pub carbs: f64,
    pub fat: f64,
    /// Grams in one serving, if the label says.
    #[serde(default)]
    pub serving_g: Option<f64>,
    /// Entered by hand (kept forever in the saved foods list).
    #[serde(default)]
    pub custom: bool,
}

impl Food {
    pub fn title(&self) -> String {
        if self.brand.is_empty() {
            self.name.clone()
        } else {
            format!("{} · {}", self.name, self.brand)
        }
    }

    pub fn macros_for(&self, grams: f64) -> Macros {
        let f = grams / 100.0;
        Macros {
            kcal: self.kcal * f,
            protein: self.protein * f,
            carbs: self.carbs * f,
            fat: self.fat * f,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Macros {
    pub kcal: f64,
    pub protein: f64,
    pub carbs: f64,
    pub fat: f64,
}

impl std::ops::Add for Macros {
    type Output = Macros;
    fn add(self, o: Macros) -> Macros {
        Macros {
            kcal: self.kcal + o.kcal,
            protein: self.protein + o.protein,
            carbs: self.carbs + o.carbs,
            fat: self.fat + o.fat,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Meal {
    Breakfast,
    Lunch,
    Dinner,
    Snacks,
}

impl Meal {
    pub const ALL: [Meal; 4] = [Meal::Breakfast, Meal::Lunch, Meal::Dinner, Meal::Snacks];

    pub fn label(self) -> &'static str {
        match self {
            Meal::Breakfast => "Breakfast",
            Meal::Lunch => "Lunch",
            Meal::Dinner => "Dinner",
            Meal::Snacks => "Snacks",
        }
    }

    /// A sensible default meal for the current hour.
    pub fn for_hour(h: u32) -> Meal {
        match h {
            4..=10 => Meal::Breakfast,
            11..=15 => Meal::Lunch,
            16..=21 => Meal::Dinner,
            _ => Meal::Snacks,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Entry {
    pub id: u64,
    /// Local date as `YYYY-MM-DD`.
    pub date: String,
    pub meal: Meal,
    /// A copy of the food, so later edits to a custom food don't rewrite history.
    pub food: Food,
    pub grams: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Goals {
    pub kcal: f64,
    pub protein: f64,
    pub carbs: f64,
    pub fat: f64,
}

impl Default for Goals {
    fn default() -> Self {
        Goals {
            kcal: 2000.0,
            protein: 150.0,
            carbs: 200.0,
            fat: 65.0,
        }
    }
}

/// Everything the app saves.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Db {
    #[serde(default)]
    pub entries: Vec<Entry>,
    /// Custom foods plus recently used ones, newest first.
    #[serde(default)]
    pub foods: Vec<Food>,
    #[serde(default)]
    pub goals: Goals,
    /// When the goals were last changed (ms since 1970), so syncing keeps the newest.
    #[serde(default)]
    pub goals_updated: u64,
    /// Ids of removed diary entries, so a removal on one device sticks on the others.
    #[serde(default)]
    pub deleted: Vec<u64>,
    /// Your training program (imported from a spreadsheet).
    #[serde(default)]
    pub program: Option<Program>,
    #[serde(default)]
    pub program_updated: u64,
    /// Every set you've logged.
    #[serde(default)]
    pub sets: Vec<LoggedSet>,
    /// Ids of removed sets.
    #[serde(default)]
    pub deleted_sets: Vec<u64>,
}

impl Db {
    pub fn day_entries(&self, date: &str) -> Vec<Entry> {
        self.entries
            .iter()
            .filter(|e| e.date == date)
            .cloned()
            .collect()
    }

    pub fn day_totals(&self, date: &str) -> Macros {
        self.entries
            .iter()
            .filter(|e| e.date == date)
            .fold(Macros::default(), |acc, e| acc + e.food.macros_for(e.grams))
    }

    /// Put a food at the front of the saved list (replacing any copy with the same id).
    pub fn remember(&mut self, food: &Food) {
        self.foods.retain(|f| f.id != food.id);
        self.foods.insert(0, food.clone());
        // Keep custom foods forever, but only the 50 most recent scanned ones.
        let mut scanned = 0;
        self.foods.retain(|f| {
            if f.custom {
                return true;
            }
            scanned += 1;
            scanned <= 50
        });
    }

    pub fn remove_entry(&mut self, id: u64) {
        self.entries.retain(|e| e.id != id);
        if !self.deleted.contains(&id) {
            self.deleted.push(id);
        }
    }

    pub fn remove_set(&mut self, id: u64) {
        self.sets.retain(|s| s.id != id);
        if !self.deleted_sets.contains(&id) {
            self.deleted_sets.push(id);
        }
    }

    pub fn set_goals(&mut self, goals: Goals, now_ms: u64) {
        self.goals = goals;
        self.goals_updated = now_ms;
    }

    /// Combine two copies of the log (e.g. this phone and the server).
    /// Nothing added on either side is lost, removals win, newest goals win.
    pub fn merge(&self, other: &Db) -> Db {
        let mut deleted = self.deleted.clone();
        for id in &other.deleted {
            if !deleted.contains(id) {
                deleted.push(*id);
            }
        }
        deleted.sort_unstable();

        let mut entries: Vec<Entry> = Vec::new();
        for e in self.entries.iter().chain(&other.entries) {
            if deleted.binary_search(&e.id).is_err() && !entries.iter().any(|x| x.id == e.id) {
                entries.push(e.clone());
            }
        }
        entries.sort_by_key(|e| e.id);

        let mut foods: Vec<Food> = Vec::new();
        for f in self.foods.iter().chain(&other.foods) {
            if !foods.iter().any(|x| x.id == f.id) {
                foods.push(f.clone());
            }
        }

        let (goals, goals_updated) = if other.goals_updated > self.goals_updated {
            (other.goals.clone(), other.goals_updated)
        } else {
            (self.goals.clone(), self.goals_updated)
        };

        let mut deleted_sets = self.deleted_sets.clone();
        for id in &other.deleted_sets {
            if !deleted_sets.contains(id) {
                deleted_sets.push(*id);
            }
        }
        deleted_sets.sort_unstable();
        let mut sets: Vec<LoggedSet> = Vec::new();
        for s in self.sets.iter().chain(&other.sets) {
            if deleted_sets.binary_search(&s.id).is_err() && !sets.iter().any(|x| x.id == s.id) {
                sets.push(s.clone());
            }
        }
        sets.sort_by_key(|s| s.id);

        let (program, program_updated) = if other.program_updated > self.program_updated {
            (other.program.clone(), other.program_updated)
        } else {
            (self.program.clone(), self.program_updated)
        };

        Db { entries, foods, goals, goals_updated, deleted, program, program_updated, sets, deleted_sets }
    }

    pub fn find_food(&self, id: &str) -> Option<Food> {
        self.foods.iter().find(|f| f.id == id).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn food(id: &str) -> Food {
        Food {
            id: id.into(),
            name: id.into(),
            kcal: 200.0,
            protein: 10.0,
            ..Default::default()
        }
    }

    #[test]
    fn macros_scale_by_grams() {
        let m = food("a").macros_for(50.0);
        assert_eq!(m.kcal, 100.0);
        assert_eq!(m.protein, 5.0);
    }

    #[test]
    fn day_totals_only_count_that_day() {
        let mut db = Db::default();
        for (id, date) in [(1, "2026-10-16"), (2, "2026-10-16"), (3, "2026-10-15")] {
            db.entries.push(Entry {
                id,
                date: date.into(),
                meal: Meal::Lunch,
                food: food("a"),
                grams: 100.0,
            });
        }
        assert_eq!(db.day_totals("2026-10-16").kcal, 400.0);
    }

    fn entry(id: u64) -> Entry {
        Entry {
            id,
            date: "2026-10-16".into(),
            meal: Meal::Lunch,
            food: food("a"),
            grams: 100.0,
        }
    }

    #[test]
    fn merge_keeps_entries_from_both_sides() {
        let mut phone = Db::default();
        phone.entries = vec![entry(1), entry(3)];
        let mut server = Db::default();
        server.entries = vec![entry(1), entry(2)];
        let ids: Vec<u64> = phone.merge(&server).entries.iter().map(|e| e.id).collect();
        assert_eq!(ids, [1, 2, 3]);
    }

    #[test]
    fn merge_applies_removals_from_either_side() {
        let mut phone = Db::default();
        phone.entries = vec![entry(1), entry(2)];
        let mut server = phone.clone();
        server.remove_entry(2);
        let merged = phone.merge(&server);
        assert_eq!(merged.entries.len(), 1);
        // And merging again in the other direction gives the same answer.
        assert_eq!(server.merge(&phone).entries, merged.entries);
    }

    #[test]
    fn merge_keeps_newest_goals() {
        let mut phone = Db::default();
        phone.set_goals(
            Goals {
                kcal: 1800.0,
                ..Goals::default()
            },
            200,
        );
        let mut server = Db::default();
        server.set_goals(
            Goals {
                kcal: 2500.0,
                ..Goals::default()
            },
            100,
        );
        assert_eq!(phone.merge(&server).goals.kcal, 1800.0);
        assert_eq!(server.merge(&phone).goals.kcal, 1800.0);
    }

    #[test]
    fn merge_combines_workout_sets_and_keeps_newest_program() {
        use crate::workout::{LoggedSet, Program};
        let set = |id| LoggedSet { id, date: "2026-10-17".into(), exercise: "Row".into(), weight: 100.0, reps: 10, week: None, day: String::new() };
        let mut phone = Db { sets: vec![set(1), set(2)], ..Db::default() };
        phone.program = Some(Program { name: "New".into(), weeks: vec![] });
        phone.program_updated = 20;
        let mut server = Db { sets: vec![set(1), set(3)], ..Db::default() };
        server.program = Some(Program { name: "Old".into(), weeks: vec![] });
        server.program_updated = 10;
        server.remove_set(2);
        let m = phone.merge(&server);
        assert_eq!(m.sets.iter().map(|s| s.id).collect::<Vec<_>>(), [1, 3]);
        assert_eq!(m.program.unwrap().name, "New");
    }

    #[test]
    fn old_backups_without_sync_fields_still_load() {
        let db: Db = serde_json::from_str(
            r#"{"entries":[],"foods":[],"goals":{"kcal":1,"protein":2,"carbs":3,"fat":4}}"#,
        )
        .unwrap();
        assert!(db.deleted.is_empty());
    }

    #[test]
    fn remember_moves_food_to_front_without_duplicates() {
        let mut db = Db::default();
        db.remember(&food("1"));
        db.remember(&food("2"));
        db.remember(&food("1"));
        let ids: Vec<_> = db.foods.iter().map(|f| f.id.as_str()).collect();
        assert_eq!(ids, ["1", "2"]);
    }
}
