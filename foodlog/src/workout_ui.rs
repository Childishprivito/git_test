//! The Workout tab: import a program, follow it day by day, log sets, see PRs.

use foodlog_core::workout::{
    self, Day, Exercise, LoggedSet, Program, Record, last_session, pr_flags, records, same_exercise,
};
use leptos::{prelude::*, task::spawn_local};
use wasm_bindgen_futures::JsFuture;

use crate::{
    app::{ctx, flash, parse_num},
    store,
};

const UNIT: &str = "lb";

/// Unique enough across devices: milliseconds plus a random tail.
fn new_id() -> u64 {
    store::now_ms() * 1000 + (js_sys::Math::random() * 1000.0) as u64
}

fn fmt_w(w: f64) -> String {
    if w.fract() == 0.0 {
        format!("{w:.0}")
    } else {
        format!("{w}")
    }
}

fn fmt_set(s: &LoggedSet) -> String {
    format!("{} × {}", fmt_w(s.weight), s.reps)
}

/// When a set was done: its date, or the program week for imported sets.
fn when(s: &LoggedSet) -> String {
    match (s.date.is_empty(), s.week) {
        (false, _) => s.date.clone(),
        (true, Some(w)) => format!("Week {w}"),
        (true, None) => "imported".into(),
    }
}

/// Was anything logged for this program day?
fn day_done(sets: &[LoggedSet], week: u32, day: &str) -> bool {
    sets.iter().any(|s| s.week == Some(week) && s.day == day)
}

/// The first day not yet done, starting from the latest week you've trained in.
fn up_next(p: &Program, sets: &[LoggedSet]) -> Option<(u32, usize)> {
    let latest = p
        .weeks
        .iter()
        .rposition(|w| w.days.iter().any(|d| day_done(sets, w.number, &d.name)))
        .unwrap_or(0);
    p.weeks[latest..].iter().find_map(|w| {
        w.days
            .iter()
            .position(|d| !day_done(sets, w.number, &d.name))
            .map(|i| (w.number, i))
    })
}

fn find_day(p: &Program, week: u32, idx: usize) -> Option<(String, Day)> {
    let w = p.weeks.iter().find(|w| w.number == week)?;
    Some((w.block.clone(), w.days.get(idx)?.clone()))
}

#[component]
pub fn WorkoutTab() -> impl IntoView {
    let c = ctx();
    move || match c.session.get() {
        Some((week, idx)) => match c
            .db
            .with_untracked(|db| db.program.as_ref().and_then(|p| find_day(p, week, idx)))
        {
            Some((block, day)) => view! { <Session week idx block day/> }.into_any(),
            None => {
                c.session.set(None);
                ().into_any()
            }
        },
        None => view! { <Overview/> }.into_any(),
    }
}

#[component]
fn Overview() -> impl IntoView {
    let c = ctx();
    let has_program = Memo::new(move |_| c.db.with(|db| db.program.is_some()));
    view! {
        <header class="page-head"><h1>"Workout"</h1></header>
        <Show when=move || has_program.get() fallback=|| view! { <ImportCard first=true/> }>
            <ProgramView/>
        </Show>
        <QuickLog/>
        <Records/>
        <Show when=move || has_program.get()>
            <details class="card">
                <summary>"Program settings"</summary>
                <ImportCard first=false/>
                <button class="btn ghost danger-text" on:click=move |_| {
                    let ok = web_sys::window()
                        .and_then(|w| w.confirm_with_message("Remove the program? Your logged sets and PRs stay.").ok())
                        .unwrap_or(false);
                    if ok {
                        c.db.update(|db| {
                            db.program = None;
                            db.program_updated = store::now_ms();
                        });
                    }
                }>"Remove program"</button>
            </details>
        </Show>
    }
}

#[component]
fn ImportCard(first: bool) -> impl IntoView {
    let c = ctx();
    let busy = RwSignal::new(false);
    let error = RwSignal::new(String::new());
    let file_ref = NodeRef::<leptos::html::Input>::new();

    let import = move |file: web_sys::File| {
        busy.set(true);
        error.set(String::new());
        let name = file.name();
        let name = name
            .rsplit_once('.')
            .map(|(n, _)| n.to_string())
            .unwrap_or(name)
            .replace('_', " ");
        spawn_local(async move {
            let result = async {
                let buf = JsFuture::from(file.array_buffer())
                    .await
                    .map_err(|_| "Couldn't open that file.".to_string())?;
                let bytes = js_sys::Uint8Array::new(&buf).to_vec();
                let grid = foodlog_core::sheet::read(&bytes)?;
                workout::import(&grid, &name, new_id())
            }
            .await;
            match result {
                Ok(imp) => {
                    let weeks = imp.program.weeks.len();
                    let mut added = 0;
                    c.db.update(|db| {
                        // Re-importing the same sheet shouldn't double up sets it brought in
                        // before: skip any exercise/day/week that already has imported sets.
                        let before: Vec<(Option<u32>, String, String)> = db
                            .sets
                            .iter()
                            .filter(|x| x.date.is_empty())
                            .map(|x| (x.week, x.day.clone(), x.exercise.to_lowercase()))
                            .collect();
                        for s in imp.sets {
                            let key = (s.week, s.day.clone(), s.exercise.to_lowercase());
                            if !before.contains(&key) {
                                db.sets.push(s);
                                added += 1;
                            }
                        }
                        db.program = Some(imp.program);
                        db.program_updated = store::now_ms();
                    });
                    flash(format!("Imported {weeks} weeks and {added} logged sets"));
                }
                Err(e) => error.set(e),
            }
            busy.set(false);
        });
    };

    view! {
        <section class=if first { "card form" } else { "form" } aria-label="Import a program">
            {first.then(|| view! {
                <h2>"Import your program"</h2>
                <p class="muted small">
                    "Choose your program spreadsheet (.ods or .xlsx), e.g. from the Files app. "
                    "Weeks, days, exercises, sets, reps, rest and notes come in, plus any weights you already logged in it. "
                    "It's read on this phone and only saved in your own log."
                </p>
            })}
            <label class="btn primary file-btn" class:big-btn=first class:disabled=move || busy.get()>
                {move || if busy.get() { "Reading…" } else if first { "Choose spreadsheet" } else { "Replace with a new spreadsheet" }}
                <input type="file" class="visually-hidden" node_ref=file_ref disabled=move || busy.get()
                    accept=".ods,.xlsx,application/vnd.oasis.opendocument.spreadsheet,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    on:change=move |_| {
                        if let Some(f) = file_ref.get().and_then(|i| i.files()).and_then(|fs| fs.get(0)) {
                            import(f);
                        }
                    }/>
            </label>
            <p class="error" role="alert">{move || error.get()}</p>
        </section>
    }
}

#[component]
fn ProgramView() -> impl IntoView {
    let c = ctx();
    let next = Memo::new(move |_| {
        c.db.with(|db| db.program.as_ref().and_then(|p| up_next(p, &db.sets)))
    });
    let week_count = Memo::new(move |_| {
        c.db.with(|db| db.program.as_ref().map_or(0, |p| p.weeks.len()))
    });
    // The week shown in the list (index into weeks).
    let shown = RwSignal::new(None::<usize>);
    let shown_idx = Memo::new(move |_| {
        shown.get().unwrap_or_else(|| {
            c.db.with(|db| {
                let p = db.program.as_ref();
                let wk = next.get().map(|(w, _)| w);
                p.and_then(|p| p.weeks.iter().position(|w| Some(w.number) == wk))
                    .unwrap_or(0)
            })
        })
    });
    let week = Memo::new(move |_| {
        c.db.with(|db| {
            db.program
                .as_ref()
                .and_then(|p| p.weeks.get(shown_idx.get()).cloned())
        })
    });

    view! {
        {move || next.get().and_then(|(w, i)| {
            let (block, day) = c.db.with(|db| db.program.as_ref().and_then(|p| find_day(p, w, i)))?;
            Some(view! {
                <section class="card up-next" aria-label="Up next">
                    <p class="muted small">{format!("Up next · Week {w}{}", if block.is_empty() { String::new() } else { format!(" · {block}") })}</p>
                    <h2>{day.name.clone()}</h2>
                    <p class="muted small">{day.exercises.iter().map(|e| e.name.as_str()).collect::<Vec<_>>().join(" · ")}</p>
                    <button class="btn primary big-btn" on:click=move |_| c.session.set(Some((w, i)))>"Start workout"</button>
                </section>
            })
        })}
        {move || next.get().is_none().then(|| view! {
            <section class="card"><h2>"Program complete 🎉"</h2>
                <p class="muted small">"Every day has sets logged. Import a new program, or keep using Quick log."</p></section>
        })}

        <section class="card" aria-label="Program weeks">
            <div class="day-nav">
                <button class="icon-btn" aria-label="Previous week" disabled=move || shown_idx.get() == 0
                    on:click=move |_| shown.set(Some(shown_idx.get_untracked().saturating_sub(1)))>"‹"</button>
                <div class="week-title">
                    <h2>{move || week.get().map(|w| format!("Week {}", w.number)).unwrap_or_default()}</h2>
                    <span class="muted small">{move || week.get().map(|w| w.block).unwrap_or_default()}</span>
                </div>
                <button class="icon-btn" aria-label="Next week" disabled=move || { shown_idx.get() + 1 >= week_count.get() }
                    on:click=move |_| shown.set(Some((shown_idx.get_untracked() + 1).min(week_count.get_untracked().saturating_sub(1))))>"›"</button>
            </div>
            <ul class="list">
                {move || week.get().map(|w| {
                    w.days.iter().enumerate().map(|(i, d)| {
                        let num = w.number;
                        let name = d.name.clone();
                        let n = d.exercises.len();
                        let done = Memo::new({
                            let name = name.clone();
                            move |_| c.db.with(|db| day_done(&db.sets, num, &name))
                        });
                        view! {
                            <li>
                                <button class="row row-btn" on:click=move |_| c.session.set(Some((num, i)))>
                                    <span class="check" class:done=move || done.get() aria-hidden="true">
                                        {move || if done.get() { "✓" } else { "" }}
                                    </span>
                                    <div class="grow">
                                        <div>{name.clone()}</div>
                                        <div class="muted small">
                                            {move || format!("{n} exercises{}", if done.get() { " · done" } else { "" })}
                                        </div>
                                    </div>
                                    <span aria-hidden="true">"›"</span>
                                </button>
                            </li>
                        }
                    }).collect_view()
                })}
            </ul>
        </section>
    }
}

#[component]
fn Session(week: u32, idx: usize, block: String, day: Day) -> impl IntoView {
    let c = ctx();
    let day_name = StoredValue::new(day.name.clone());
    let logged = Memo::new(move |_| {
        c.db.with(|db| {
            db.sets
                .iter()
                .filter(|s| s.week == Some(week) && day_name.with_value(|d| &s.day == d))
                .count()
        })
    });
    let _ = idx;
    view! {
        <header class="page-head session-head">
            <button class="btn ghost" on:click=move |_| c.session.set(None)>"‹ Program"</button>
        </header>
        <h1>{day.name.clone()}</h1>
        <p class="muted small">{format!("Week {week}{}", if block.is_empty() { String::new() } else { format!(" · {block}") })}</p>
        {day.exercises.into_iter().map(|ex| view! { <ExerciseCard week day=day_name.get_value() ex/> }).collect_view()}
        <button class="btn primary big-btn" on:click=move |_| {
            let n = logged.get_untracked();
            c.session.set(None);
            if n > 0 {
                flash(format!("Workout saved · {n} sets"));
            }
        }>{move || if logged.get() > 0 { "Finish workout" } else { "Back to program" }}</button>
    }
}

#[component]
fn ExerciseCard(week: u32, day: String, ex: Exercise) -> impl IntoView {
    let c = ctx();
    let day = StoredValue::new(day);
    let options: Vec<String> = std::iter::once(ex.name.clone())
        .chain(ex.substitutions.iter().cloned())
        .collect();
    let options = StoredValue::new(options);
    let in_session = move |s: &LoggedSet| s.week == Some(week) && day.with_value(|d| &s.day == d);

    // Sets logged for this exercise (or a substitute) in this workout.
    let session_sets = Memo::new(move |_| {
        c.db.with(|db| {
            db.sets
                .iter()
                .filter(|s| {
                    in_session(s)
                        && options.with_value(|o| o.iter().any(|n| same_exercise(n, &s.exercise)))
                })
                .cloned()
                .collect::<Vec<_>>()
        })
    });
    // Keep a substitute you already started with.
    let chosen = RwSignal::new(
        session_sets
            .get_untracked()
            .first()
            .map(|s| s.exercise.clone())
            .unwrap_or(ex.name.clone()),
    );
    let last = Memo::new(move |_| {
        let name = chosen.get();
        c.db.with(|db| {
            let before: Vec<LoggedSet> =
                db.sets.iter().filter(|s| !in_session(s)).cloned().collect();
            last_session(&name, &before, None)
        })
    });
    let record = Memo::new(move |_| {
        let name = chosen.get();
        c.db.with(|db| {
            let mine: Vec<LoggedSet> = db
                .sets
                .iter()
                .filter(|s| same_exercise(&s.exercise, &name))
                .cloned()
                .collect();
            records(&mine).into_iter().next()
        })
    });
    let pr_ids = RwSignal::new(Vec::<u64>::new());

    let weight = RwSignal::new(String::new());
    let reps = RwSignal::new(String::new());
    // Suggest what you did last time for the same set number.
    let suggestion = move || {
        let n = session_sets.with(Vec::len);
        last.with(|l| l.get(n).or(l.last()).cloned())
    };
    let log = move || {
        let s = suggestion();
        let w = parse_num(&weight.get_untracked()).or(s.as_ref().map(|s| s.weight));
        let r = reps
            .get_untracked()
            .trim()
            .parse::<u32>()
            .ok()
            .or(s.as_ref().map(|s| s.reps));
        let (Some(w), Some(r)) = (w, r) else {
            flash("Enter the weight and reps");
            return;
        };
        let set = LoggedSet {
            id: new_id(),
            date: store::date_string(0),
            exercise: chosen.get_untracked(),
            weight: w,
            reps: r,
            week: Some(week),
            day: day.get_value(),
        };
        let flags = c.db.with_untracked(|db| pr_flags(&set, &db.sets));
        if flags.any() {
            pr_ids.update(|v| v.push(set.id));
            flash(format!(
                "🏆 New {} PR: {} {UNIT} × {}",
                if flags.weight { "weight" } else { "est. 1RM" },
                fmt_w(w),
                r
            ));
        }
        c.db.update(|db| db.sets.push(set));
        reps.set(String::new());
        weight.set(fmt_w(w));
    };

    let target = format!(
        "{} × {} reps{}{}",
        ex.working_sets,
        ex.reps,
        if ex.last_rpe.is_empty() {
            String::new()
        } else {
            format!(" · RPE {}", ex.last_rpe)
        },
        if ex.rest.is_empty() {
            String::new()
        } else {
            format!(" · rest {}", ex.rest)
        },
    );
    let has_subs = !ex.substitutions.is_empty();
    let video = ex.video.clone();
    let warmup = ex.warmup_sets.clone();
    let early = ex.early_rpe.clone();
    let notes = ex.notes.clone();
    let technique = ex.technique.clone();
    let title = ex.name.clone();

    view! {
        <section class="card exercise" aria-label=title.clone()>
            <div class="meal-head">
                <h2>{move || chosen.get()}</h2>
                {video.map(|v| view! {
                    <a class="btn ghost small" href=v target="_blank" rel="noopener" aria-label=format!("Video: {title}")>"▶ Video"</a>
                })}
            </div>
            <p class="muted small">{target}</p>
            {(!technique.is_empty()).then(|| view! { <p class="pill">{format!("Last set: {technique}")}</p> })}
            {has_subs.then(|| view! {
                <label class="inline small-select">
                    <span class="muted small">"Doing"</span>
                    <select aria-label="Exercise or substitute" on:change=move |ev| chosen.set(event_target_value(&ev))>
                        {options.get_value().into_iter().map(|o| {
                            let (sel, value) = (o.clone(), o.clone());
                            view! { <option value=value selected=move || chosen.get() == sel>{o}</option> }
                        }).collect_view()}
                    </select>
                </label>
            })}
            <p class="small history">
                {move || {
                    let l = last.get();
                    if l.is_empty() {
                        "First time — pick a weight you can do with good form.".to_string()
                    } else {
                        format!("Last time ({}): {}", when(&l[0]), l.iter().map(fmt_set).collect::<Vec<_>>().join(", "))
                    }
                }}
                {move || record.get().map(|r| view! {
                    <br/><span class="muted">{format!(
                        "PR: {} {UNIT} × {} · best est. 1RM {:.0} {UNIT}",
                        fmt_w(r.heaviest.weight), r.heaviest.reps, r.best_e1rm.e1rm()
                    )}</span>
                })}
            </p>

            <ol class="sets">
                <For
                    each=move || session_sets.get()
                    key=|s: &LoggedSet| s.id
                    children=move |s: LoggedSet| {
                        let id = s.id;
                        let label = format!("{} {UNIT} × {}", fmt_w(s.weight), s.reps);
                        let pr = move || pr_ids.with(|v| v.contains(&id));
                        view! {
                            <li class="set-row">
                                <span class="grow">{label.clone()}{move || pr().then_some(" 🏆")}</span>
                                <button class="icon-btn danger" aria-label=format!("Remove set {label}")
                                    on:click=move |_| c.db.update(|db| db.remove_set(id))>"✕"</button>
                            </li>
                        }
                    }
                />
            </ol>
            <form class="set-entry" on:submit=move |ev| { ev.prevent_default(); log(); }>
                <span class="muted small set-no">{move || format!("Set {}", session_sets.with(Vec::len) + 1)}</span>
                <input inputmode="decimal" autocomplete="off" aria-label=format!("Weight ({UNIT})")
                    placeholder=move || suggestion().map(|s| fmt_w(s.weight)).unwrap_or_else(|| UNIT.into())
                    prop:value=move || weight.get() on:input=move |ev| weight.set(event_target_value(&ev))/>
                <span aria-hidden="true">"×"</span>
                <input inputmode="numeric" autocomplete="off" aria-label="Reps"
                    placeholder=move || suggestion().map(|s| s.reps.to_string()).unwrap_or_else(|| "reps".into())
                    prop:value=move || reps.get() on:input=move |ev| reps.set(event_target_value(&ev))/>
                <button class="btn primary" type="submit">"Log"</button>
            </form>

            <details>
                <summary class="small">"Notes & warm-up"</summary>
                <ul class="small notes">
                    {(!warmup.is_empty()).then(|| view! { <li>{format!("Warm-up sets: {warmup}")}</li> })}
                    {(!early.is_empty()).then(|| view! { <li>{format!("Early sets RPE {early}")}</li> })}
                    {(!notes.is_empty()).then(|| view! { <li>{notes.clone()}</li> })}
                </ul>
            </details>
        </section>
    }
}

/// Log a set of anything, outside the program.
#[component]
fn QuickLog() -> impl IntoView {
    let c = ctx();
    let name = RwSignal::new(String::new());
    let weight = RwSignal::new(String::new());
    let reps = RwSignal::new(String::new());
    let known = Memo::new(move |_| {
        c.db.with(|db| {
            let mut names: Vec<String> = Vec::new();
            let program = db
                .program
                .iter()
                .flat_map(|p| &p.weeks)
                .flat_map(|w| &w.days)
                .flat_map(|d| &d.exercises);
            for n in program
                .map(|e| e.name.clone())
                .chain(db.sets.iter().map(|s| s.exercise.clone()))
            {
                if !names.iter().any(|x| same_exercise(x, &n)) {
                    names.push(n);
                }
            }
            names.sort_by_key(|n| n.to_lowercase());
            names
        })
    });
    let log = move || {
        let n = name.get_untracked().trim().to_string();
        let (Some(w), Ok(r)) = (
            parse_num(&weight.get_untracked()),
            reps.get_untracked().trim().parse::<u32>(),
        ) else {
            flash("Enter the exercise, weight and reps");
            return;
        };
        if n.is_empty() {
            flash("Enter the exercise");
            return;
        }
        let set = LoggedSet {
            id: new_id(),
            date: store::date_string(0),
            exercise: n,
            weight: w,
            reps: r,
            week: None,
            day: String::new(),
        };
        let flags = c.db.with_untracked(|db| pr_flags(&set, &db.sets));
        flash(if flags.any() {
            format!("🏆 New PR: {} {UNIT} × {r}", fmt_w(w))
        } else {
            "Set logged".into()
        });
        c.db.update(|db| db.sets.push(set));
        reps.set(String::new());
    };
    view! {
        <details class="card">
            <summary>"Quick log a set"</summary>
            <form class="form" on:submit=move |ev| { ev.prevent_default(); log(); }>
                <label for="ql-name">"Exercise"</label>
                <input id="ql-name" list="ql-names" autocomplete="off" prop:value=move || name.get()
                    on:input=move |ev| name.set(event_target_value(&ev))/>
                <datalist id="ql-names">
                    {move || known.get().into_iter().map(|n| view! { <option value=n/> }).collect_view()}
                </datalist>
                <div class="input-row">
                    <input inputmode="decimal" aria-label=format!("Weight ({UNIT})") placeholder=UNIT
                        prop:value=move || weight.get() on:input=move |ev| weight.set(event_target_value(&ev))/>
                    <span aria-hidden="true">"×"</span>
                    <input inputmode="numeric" aria-label="Reps" placeholder="reps"
                        prop:value=move || reps.get() on:input=move |ev| reps.set(event_target_value(&ev))/>
                    <button class="btn primary" type="submit">"Log"</button>
                </div>
            </form>
        </details>
    }
}

#[component]
fn Records() -> impl IntoView {
    let c = ctx();
    let all = Memo::new(move |_| c.db.with(|db| records(&db.sets)));
    let filter = RwSignal::new(String::new());
    view! {
        <section class="card" aria-label="Personal records">
            <h2>"🏆 PRs"</h2>
            <Show when=move || !all.with(Vec::is_empty)
                fallback=|| view! { <p class="muted small">"Log some sets and your best lifts show up here."</p> }>
                <input type="search" aria-label="Find an exercise" placeholder="Find an exercise"
                    prop:value=move || filter.get() on:input=move |ev| filter.set(event_target_value(&ev))/>
                <ul class="list">
                    <For
                        each=move || {
                            let f = filter.get().to_lowercase();
                            all.get().into_iter().filter(|r| r.exercise.to_lowercase().contains(&f)).collect::<Vec<_>>()
                        }
                        key=|r: &Record| (r.exercise.clone(), r.heaviest.id, r.best_e1rm.id, r.total_sets)
                        children=move |r: Record| view! { <RecordRow r/> }
                    />
                </ul>
            </Show>
        </section>
    }
}

#[component]
fn RecordRow(r: Record) -> impl IntoView {
    let c = ctx();
    let name = r.exercise.clone();
    let history = move || {
        c.db.with(|db| {
            let mut mine: Vec<LoggedSet> = db
                .sets
                .iter()
                .filter(|s| same_exercise(&s.exercise, &name))
                .cloned()
                .collect();
            mine.sort_by(|a, b| (&b.date, b.week, b.id).cmp(&(&a.date, a.week, a.id)));
            // Group into sessions (same date / program day), newest first.
            let mut groups: Vec<(String, Vec<String>)> = Vec::new();
            for s in mine {
                let key = when(&s);
                match groups.last_mut() {
                    Some((k, v)) if *k == key => v.push(fmt_set(&s)),
                    _ => groups.push((key, vec![fmt_set(&s)])),
                }
            }
            groups.truncate(8);
            groups
        })
    };
    view! {
        <li>
            <details class="record">
                <summary class="row">
                    <div class="grow">
                        <div>{r.exercise.clone()}</div>
                        <div class="muted small">
                            {format!("Heaviest {} {UNIT} × {} ({}) · est. 1RM {:.0} {UNIT}",
                                fmt_w(r.heaviest.weight), r.heaviest.reps, when(&r.heaviest), r.best_e1rm.e1rm())}
                        </div>
                    </div>
                </summary>
                <ul class="small history-list">
                    {move || history().into_iter().map(|(k, v)| view! {
                        <li><span class="muted">{k}": "</span>{v.join(", ")}</li>
                    }).collect_view()}
                </ul>
            </details>
        </li>
    }
}
