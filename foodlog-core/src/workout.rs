//! Workout programs, logged sets and personal records.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Program {
    pub name: String,
    pub weeks: Vec<Week>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Week {
    pub number: u32,
    /// e.g. "Block 1: 5-week build phase".
    #[serde(default)]
    pub block: String,
    pub days: Vec<Day>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Day {
    /// e.g. "Pull #1 (Lat Focused)".
    pub name: String,
    pub exercises: Vec<Exercise>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Exercise {
    pub name: String,
    #[serde(default)]
    pub video: Option<String>,
    /// Last-set intensity technique, e.g. "Dropset". Empty if none.
    #[serde(default)]
    pub technique: String,
    #[serde(default)]
    pub warmup_sets: String,
    pub working_sets: u32,
    /// Target reps, e.g. "8-10".
    pub reps: String,
    #[serde(default)]
    pub early_rpe: String,
    #[serde(default)]
    pub last_rpe: String,
    #[serde(default)]
    pub rest: String,
    #[serde(default)]
    pub substitutions: Vec<String>,
    #[serde(default)]
    pub notes: String,
}

/// One set you did.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LoggedSet {
    pub id: u64,
    /// `YYYY-MM-DD`, or "" for sets imported from the spreadsheet.
    pub date: String,
    pub exercise: String,
    pub weight: f64,
    pub reps: u32,
    /// Program week and day it belongs to, if any.
    #[serde(default)]
    pub week: Option<u32>,
    #[serde(default)]
    pub day: String,
}

impl LoggedSet {
    /// Estimated one-rep max (Epley formula).
    pub fn e1rm(&self) -> f64 {
        if self.reps == 0 {
            return 0.0;
        }
        if self.reps == 1 {
            return self.weight;
        }
        self.weight * (1.0 + self.reps as f64 / 30.0)
    }
}

/// Exercises match ignoring case and extra spaces.
pub fn same_exercise(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    norm(a) == norm(b)
}

/// Best sets for one exercise.
#[derive(Clone, Debug, PartialEq)]
pub struct Record {
    pub exercise: String,
    /// Heaviest weight (most reps at it, if tied).
    pub heaviest: LoggedSet,
    /// Highest estimated one-rep max.
    pub best_e1rm: LoggedSet,
    pub total_sets: usize,
}

pub fn records(sets: &[LoggedSet]) -> Vec<Record> {
    let mut out: Vec<Record> = Vec::new();
    for s in sets.iter().filter(|s| s.reps > 0) {
        match out.iter_mut().find(|r| same_exercise(&r.exercise, &s.exercise)) {
            Some(r) => {
                r.total_sets += 1;
                if (s.weight, s.reps) > (r.heaviest.weight, r.heaviest.reps) {
                    r.heaviest = s.clone();
                }
                if s.e1rm() > r.best_e1rm.e1rm() {
                    r.best_e1rm = s.clone();
                }
            }
            None => out.push(Record {
                exercise: s.exercise.clone(),
                heaviest: s.clone(),
                best_e1rm: s.clone(),
                total_sets: 1,
            }),
        }
    }
    out.sort_by(|a, b| a.exercise.to_lowercase().cmp(&b.exercise.to_lowercase()));
    out
}

/// What a new set beats, compared with everything logged before it.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PrFlags {
    pub weight: bool,
    pub e1rm: bool,
}

impl PrFlags {
    pub fn any(self) -> bool {
        self.weight || self.e1rm
    }
}

pub fn pr_flags(new: &LoggedSet, history: &[LoggedSet]) -> PrFlags {
    let past: Vec<&LoggedSet> =
        history.iter().filter(|s| s.id != new.id && s.reps > 0 && same_exercise(&s.exercise, &new.exercise)).collect();
    if past.is_empty() || new.reps == 0 {
        // The first time isn't a "record", just a starting point.
        return PrFlags::default();
    }
    let max_w = past.iter().map(|s| s.weight).fold(f64::MIN, f64::max);
    let max_e = past.iter().map(|s| s.e1rm()).fold(f64::MIN, f64::max);
    PrFlags { weight: new.weight > max_w, e1rm: new.e1rm() > max_e + 1e-9 }
}

/// The most recent session's sets for an exercise (newest date, then newest id).
pub fn last_session(exercise: &str, sets: &[LoggedSet], before_id: Option<u64>) -> Vec<LoggedSet> {
    let mut matching: Vec<&LoggedSet> = sets
        .iter()
        .filter(|s| same_exercise(&s.exercise, exercise) && before_id.is_none_or(|b| s.id < b))
        .collect();
    matching.sort_by(|a, b| (&a.date, a.week, a.id).cmp(&(&b.date, b.week, b.id)));
    let Some(last) = matching.last() else { return Vec::new() };
    let key = (last.date.clone(), last.week, last.day.clone());
    matching.into_iter().filter(|s| (s.date.clone(), s.week, s.day.clone()) == key).cloned().collect()
}

/// "135 - 8", "155 -6", "60 12", "37.5x15" -> (weight, reps).
pub fn parse_load_reps(s: &str) -> Option<(f64, u32)> {
    let nums: Vec<&str> = s
        .split(|c: char| !(c.is_ascii_digit() || c == '.'))
        .filter(|t| !t.is_empty() && *t != ".")
        .collect();
    match nums.as_slice() {
        [w, r] => Some((w.parse().ok()?, r.parse().ok()?)),
        _ => None,
    }
}

/// A program read from a spreadsheet, plus any sets already written in it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Imported {
    pub program: Program,
    pub sets: Vec<LoggedSet>,
}

/// Read a program laid out like Jeff Nippard's sheets: a header row starting
/// "Week N | Exercise | …", one row per exercise, the day name in the first
/// column of its first exercise, and "Set 1..N" columns for tracking.
#[cfg(feature = "import")]
pub fn import(grid: &crate::sheet::Grid, name: &str, first_id: u64) -> Result<Imported, String> {
    let text = |r: &[crate::sheet::Cell], c: Option<usize>| -> String {
        c.and_then(|c| r.get(c)).map(|x| x.text.trim().to_string()).unwrap_or_default()
    };
    let mut out = Imported { program: Program { name: name.to_string(), weeks: Vec::new() }, sets: Vec::new() };
    let mut block = String::new();
    let mut next_id = first_id;
    let mut i = 0;
    while i < grid.len() {
        let row = &grid[i];
        let a = text(row, Some(0));
        if a.to_uppercase().starts_with("BLOCK") {
            block = tidy_block(&a);
        }
        let week_no = a.strip_prefix("Week").and_then(|n| n.trim().parse::<u32>().ok());
        let ex_col = row.iter().position(|c| c.text.trim().eq_ignore_ascii_case("Exercise"));
        let (Some(week_no), Some(ex_col)) = (week_no, ex_col) else {
            i += 1;
            continue;
        };
        // Columns by their header names.
        let find = |words: &[&str]| {
            row.iter().position(|c| {
                let t = c.text.to_lowercase();
                words.iter().all(|w| t.contains(w))
            })
        };
        let col_tech = find(&["technique"]);
        let col_warm = find(&["warm"]);
        let col_work = find(&["working"]);
        let col_reps = row.iter().position(|c| c.text.trim().eq_ignore_ascii_case("reps"));
        let col_early = find(&["early", "rpe"]);
        let col_last = find(&["last set", "rpe"]);
        let col_rest = find(&["rest"]);
        let col_sub1 = find(&["substitution", "1"]);
        let col_sub2 = find(&["substitution", "2"]);
        let col_notes = find(&["notes"]);
        // "Set 1", "Set 2", … usually sit on the row below the header.
        let mut set_cols: Vec<usize> = Vec::new();
        if let Some(next) = grid.get(i + 1) {
            set_cols = next
                .iter()
                .enumerate()
                .filter(|(_, c)| c.text.trim().to_lowercase().starts_with("set "))
                .map(|(j, _)| j)
                .collect();
            if !set_cols.is_empty() {
                i += 1;
            }
        }

        let wi = match out.program.weeks.iter().position(|w| w.number == week_no) {
            Some(wi) => wi,
            None => {
                out.program.weeks.push(Week { number: week_no, block: block.clone(), days: Vec::new() });
                out.program.weeks.len() - 1
            }
        };
        i += 1;
        while i < grid.len() {
            let row = &grid[i];
            let a = text(row, Some(0));
            if a.starts_with("Week") || a.to_uppercase().starts_with("BLOCK") {
                break;
            }
            i += 1;
            if a.to_lowercase().contains("rest day") {
                continue;
            }
            let ex_name = text(row, Some(ex_col));
            if !a.is_empty() {
                let day = a.split_whitespace().collect::<Vec<_>>().join(" ");
                out.program.weeks[wi].days.push(Day { name: day, exercises: Vec::new() });
            }
            let Some(day) = out.program.weeks[wi].days.last_mut() else { continue };
            if ex_name.is_empty() {
                continue;
            }
            let subs = [text(row, col_sub1), text(row, col_sub2)]
                .into_iter()
                .filter(|s| !s.is_empty() && !s.to_lowercase().starts_with("see "))
                .collect();
            let technique = text(row, col_tech);
            let ex = Exercise {
                name: ex_name.clone(),
                video: row.get(ex_col).and_then(|c| c.link.clone()),
                technique: if technique.eq_ignore_ascii_case("n/a") { String::new() } else { technique },
                warmup_sets: text(row, col_warm),
                working_sets: text(row, col_work).parse().unwrap_or(0),
                reps: text(row, col_reps),
                early_rpe: text(row, col_early),
                last_rpe: text(row, col_last),
                rest: text(row, col_rest),
                substitutions: subs,
                notes: text(row, col_notes),
            };
            for &c in &set_cols {
                if let Some((weight, reps)) = parse_load_reps(&text(row, Some(c))) {
                    out.sets.push(LoggedSet {
                        id: next_id,
                        date: String::new(),
                        exercise: ex.name.clone(),
                        weight,
                        reps,
                        week: Some(week_no),
                        day: day.name.clone(),
                    });
                    next_id += 1;
                }
            }
            day.exercises.push(ex);
        }
    }
    out.program.weeks.sort_by_key(|w| w.number);
    if out.program.weeks.iter().all(|w| w.days.is_empty()) {
        return Err("Couldn't find any weeks in that sheet. It needs rows like “Week 1 | Exercise | …”.".into());
    }
    Ok(out)
}

/// "BLOCK 1: 5-WEEK BUILD PHASE" -> "Block 1: 5-week build phase".
#[cfg(feature = "import")]
fn tidy_block(s: &str) -> String {
    let lower = s.trim().to_lowercase();
    let mut c = lower.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(id: u64, ex: &str, w: f64, r: u32) -> LoggedSet {
        LoggedSet { id, date: format!("2026-10-{:02}", id), exercise: ex.into(), weight: w, reps: r, week: None, day: String::new() }
    }

    #[test]
    fn parses_tracking_cells() {
        assert_eq!(parse_load_reps("135 - 8 "), Some((135.0, 8)));
        assert_eq!(parse_load_reps("155 -6"), Some((155.0, 6)));
        assert_eq!(parse_load_reps("37.5 - 15"), Some((37.5, 15)));
        assert_eq!(parse_load_reps("60 12"), Some((60.0, 12)));
        assert_eq!(parse_load_reps("Set 1"), None);
        assert_eq!(parse_load_reps(""), None);
    }

    #[test]
    fn records_track_heaviest_and_e1rm_separately() {
        let sets = [set(1, "Hack Squat", 270.0, 4), set(2, "hack  squat", 225.0, 12), set(3, "Leg Press", 300.0, 8)];
        let r = records(&sets);
        let hack = r.iter().find(|r| r.exercise == "Hack Squat").unwrap();
        assert_eq!(hack.heaviest.weight, 270.0);
        assert_eq!(hack.best_e1rm.weight, 225.0); // 225x12 ≈ 315 beats 270x4 ≈ 306
        assert_eq!(hack.total_sets, 2);
    }

    #[test]
    fn pr_flags_compare_with_history_only() {
        let hist = [set(1, "Bench", 135.0, 10), set(2, "Bench", 155.0, 6)];
        assert!(pr_flags(&set(3, "Bench", 160.0, 3), &hist).weight);
        assert!(!pr_flags(&set(3, "Bench", 135.0, 8), &hist).any());
        assert!(pr_flags(&set(3, "Bench", 135.0, 14), &hist).e1rm);
        assert!(!pr_flags(&set(3, "Squat", 500.0, 1), &hist).any(), "first time isn't a PR");
    }

    #[test]
    fn last_session_groups_by_date() {
        let sets = [set(1, "Row", 100.0, 10), set(2, "Row", 110.0, 8), set(2, "Row", 110.0, 7), set(3, "Curl", 30.0, 10)];
        let last = last_session("row", &sets, None);
        assert_eq!(last.len(), 2);
        assert!(last.iter().all(|s| s.weight == 110.0));
    }

    /// Runs against a real program file if you point IMPORT_TEST_FILE at one.
    /// (Programs are copyrighted, so none is kept in the repo.)
    #[cfg(feature = "import")]
    #[test]
    fn imports_real_file_if_given() {
        let Ok(path) = std::env::var("IMPORT_TEST_FILE") else { return };
        let grid = crate::sheet::read(&std::fs::read(path).unwrap()).unwrap();
        let imp = import(&grid, "Test", 1).unwrap();
        for w in &imp.program.weeks {
            println!("Week {} ({}): {} days", w.number, w.block, w.days.len());
            for d in &w.days {
                println!("  {}: {}", d.name, d.exercises.iter().map(|e| format!("{} {}x{}", e.name, e.working_sets, e.reps)).collect::<Vec<_>>().join(", "));
            }
        }
        for s in &imp.sets {
            println!("SET wk{:?} {} | {} {}x{}", s.week, s.day, s.exercise, s.weight, s.reps);
        }
        let ex = &imp.program.weeks[0].days[0].exercises[1];
        println!("SAMPLE {:?}", ex);
        assert!(!imp.program.weeks.is_empty());
    }
}
