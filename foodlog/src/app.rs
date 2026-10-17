//! Screens: Diary, Add food, Settings, plus the "how much?" sheet.

use leptos::{prelude::*, task::spawn_local};

use foodlog_core::estimate::{Estimate, EstimateRequest};
use send_wrapper::SendWrapper;

use crate::{
    model::{Db, Entry, Food, Macros, Meal},
    off, photo,
    scanner::Scanner,
    server, store,
};

#[derive(Clone, Copy, PartialEq)]
enum Tab {
    Diary,
    Add,
    Settings,
}

/// Shared app state, handed to every screen through context.
#[derive(Clone, Copy)]
struct Ctx {
    db: RwSignal<Db>,
    /// 0 = today, -1 = yesterday, ...
    day: RwSignal<i32>,
    tab: RwSignal<Tab>,
    /// Meal new food goes into.
    meal: RwSignal<Meal>,
    /// Food being added (opens the amount sheet).
    picked: RwSignal<Option<Food>>,
    /// Short message read out by screen readers and shown on screen.
    toast: RwSignal<String>,
    /// e.g. "Synced", "Offline — will sync later". Empty when no server is set up.
    sync_status: RwSignal<String>,
    /// Bump to sync right away (e.g. "Sync now" button, app reopened).
    sync_nudge: RwSignal<u32>,
}

fn ctx() -> Ctx {
    expect_context::<Ctx>()
}

fn parse_num(s: &str) -> Option<f64> {
    s.trim()
        .replace(',', ".")
        .parse::<f64>()
        .ok()
        .filter(|n| n.is_finite() && *n >= 0.0)
}

fn day_label(offset: i32) -> String {
    match offset {
        0 => "Today".into(),
        -1 => "Yesterday".into(),
        1 => "Tomorrow".into(),
        _ => store::date_string(offset),
    }
}

#[component]
pub fn App() -> impl IntoView {
    let c = Ctx {
        db: RwSignal::new(store::load()),
        day: RwSignal::new(0),
        tab: RwSignal::new(Tab::Diary),
        meal: RwSignal::new(Meal::for_hour(store::current_hour())),
        picked: RwSignal::new(None),
        toast: RwSignal::new(String::new()),
        sync_status: RwSignal::new(String::new()),
        sync_nudge: RwSignal::new(0),
    };
    provide_context(c);
    start_sync(c);

    let tab_button = move |t: Tab, label: &'static str, icon: &'static str| {
        view! {
            <button
                class="tab"
                class:active=move || c.tab.get() == t
                aria-current=move || (c.tab.get() == t).then_some("page")
                on:click=move |_| c.tab.set(t)
            >
                <span class="tab-icon" aria-hidden="true">{icon}</span>
                {label}
            </button>
        }
    };

    view! {
        <main class="screen">
            {move || match c.tab.get() {
                Tab::Diary => view! { <Diary/> }.into_any(),
                Tab::Add => view! { <AddFood/> }.into_any(),
                Tab::Settings => view! { <Settings/> }.into_any(),
            }}
        </main>
        <p class="toast" role="status" aria-live="polite" class:show=move || !c.toast.get().is_empty()>
            {move || c.toast.get()}
        </p>
        <Show when=move || c.picked.with(Option::is_some)>
            <AmountSheet/>
        </Show>
        <nav class="tabs" aria-label="Main">
            {tab_button(Tab::Diary, "Diary", "📖")}
            {tab_button(Tab::Add, "Add food", "➕")}
            {tab_button(Tab::Settings, "Settings", "⚙️")}
        </nav>
    }
}

/// Save every change on the phone, and (if a server is set up) send it there
/// a moment later. The server merges in other devices' changes and sends the
/// combined log back.
fn start_sync(c: Ctx) {
    // The log as last agreed with the server, to skip pointless uploads.
    let last_synced = StoredValue::new(None::<Db>);
    let generation = StoredValue::new(0u64);

    let run = move || {
        if server::config().is_none() {
            c.sync_status.set(String::new());
            return;
        }
        let sent = c.db.get_untracked();
        c.sync_status.set("Syncing…".into());
        spawn_local(async move {
            match server::sync(&sent).await {
                Ok(merged) => {
                    last_synced.set_value(Some(merged.clone()));
                    // Keep anything added on this phone while the request was out.
                    let now = c.db.get_untracked();
                    let next = if now == sent {
                        merged
                    } else {
                        now.merge(&merged)
                    };
                    if next != now {
                        c.db.set(next);
                    }
                    c.sync_status.set("Synced".into());
                }
                Err(e) => c.sync_status.set(format!("Not synced: {e}")),
            }
        });
    };

    Effect::new(move |_| {
        c.sync_nudge.track();
        c.db.with(store::save);
        let unchanged =
            c.db.with(|db| last_synced.with_value(|l| l.as_ref() == Some(db)));
        if unchanged && c.sync_nudge.get_untracked() == 0 {
            return;
        }
        // Wait for a pause in edits, then upload once.
        generation.update_value(|g| *g += 1);
        let mine = generation.get_value();
        set_timeout(
            move || {
                if generation.get_value() == mine {
                    run();
                }
            },
            std::time::Duration::from_millis(1200),
        );
    });

    // Pick up other devices' changes when the app comes back to the screen.
    let on_visible = wasm_bindgen::closure::Closure::<dyn Fn()>::new(move || {
        let visible = web_sys::window()
            .and_then(|w| w.document())
            .is_some_and(|d| d.visibility_state() == web_sys::VisibilityState::Visible);
        if visible {
            c.sync_nudge.update(|n| *n += 1);
        }
    });
    if let Some(doc) = web_sys::window().and_then(|w| w.document()) {
        use wasm_bindgen::JsCast;
        let _ = doc.add_event_listener_with_callback(
            "visibilitychange",
            on_visible.as_ref().unchecked_ref(),
        );
    }
    on_visible.forget(); // lives as long as the app
}

fn flash(msg: impl Into<String>) {
    let toast = ctx().toast;
    let msg = msg.into();
    toast.set(msg.clone());
    set_timeout(
        move || {
            if toast.get_untracked() == msg {
                toast.set(String::new());
            }
        },
        std::time::Duration::from_secs(3),
    );
}

// ---------- Diary ----------

#[component]
fn Diary() -> impl IntoView {
    let c = ctx();
    let date = Memo::new(move |_| store::date_string(c.day.get()));
    let totals = Memo::new(move |_| c.db.with(|db| db.day_totals(&date.get())));
    let goals = move || c.db.with(|db| db.goals.clone());

    view! {
        <header class="day-nav">
            <button class="icon-btn" aria-label="Previous day" on:click=move |_| c.day.update(|d| *d -= 1)>"‹"</button>
            <h1>{move || day_label(c.day.get())}</h1>
            <button class="icon-btn" aria-label="Next day" on:click=move |_| c.day.update(|d| *d += 1)>"›"</button>
        </header>

        <section class="card summary" aria-label="Daily summary">
            <div class="kcal">
                <div>
                    {move || {
                        let left = goals().kcal - totals.get().kcal;
                        let (n, word) = if left >= 0.0 { (left, " kcal left") } else { (-left, " kcal over") };
                        view! { <span class="big">{format!("{n:.0}")}</span><span class="muted">{word}</span> }
                    }}
                </div>
                <div class="muted">
                    {move || format!("{:.0} eaten of {:.0}", totals.get().kcal, goals().kcal)}
                </div>
            </div>
            <Bar label="Calories" unit="kcal" value=Signal::derive(move || totals.get().kcal) goal=Signal::derive(move || goals().kcal)/>
            <Bar label="Protein" unit="g" value=Signal::derive(move || totals.get().protein) goal=Signal::derive(move || goals().protein)/>
            <Bar label="Carbs" unit="g" value=Signal::derive(move || totals.get().carbs) goal=Signal::derive(move || goals().carbs)/>
            <Bar label="Fat" unit="g" value=Signal::derive(move || totals.get().fat) goal=Signal::derive(move || goals().fat)/>
        </section>

        {Meal::ALL.into_iter().map(|meal| view! { <MealSection meal date/> }).collect_view()}
    }
}

#[component]
fn Bar(
    label: &'static str,
    unit: &'static str,
    value: Signal<f64>,
    goal: Signal<f64>,
) -> impl IntoView {
    let pct = move || {
        if goal.get() > 0.0 {
            (value.get() / goal.get() * 100.0).min(100.0)
        } else {
            0.0
        }
    };
    let over = move || value.get() > goal.get() && goal.get() > 0.0;
    view! {
        <div class="bar-row">
            <div class="bar-label">
                <span>{label}</span>
                <span class="muted">
                    {move || format!("{:.0} / {:.0} {unit}", value.get(), goal.get())}
                    {move || over().then_some(" · over")}
                </span>
            </div>
            <div
                class="bar"
                class:over=over
                role="progressbar"
                aria-label=label
                aria-valuemin="0"
                aria-valuemax=move || format!("{:.0}", goal.get())
                aria-valuenow=move || format!("{:.0}", value.get())
            >
                <div class="fill" style:width=move || format!("{}%", pct())></div>
            </div>
        </div>
    }
}

#[component]
fn MealSection(meal: Meal, date: Memo<String>) -> impl IntoView {
    let c = ctx();
    let entries = Memo::new(move |_| {
        c.db.with(|db| {
            db.day_entries(&date.get())
                .into_iter()
                .filter(|e| e.meal == meal)
                .collect::<Vec<_>>()
        })
    });
    let kcal = move || {
        entries.with(|es| {
            es.iter()
                .fold(0.0, |sum, e| sum + e.food.macros_for(e.grams).kcal)
        })
    };

    view! {
        <section class="card meal" aria-label=meal.label()>
            <div class="meal-head">
                <h2>{meal.label()}</h2>
                <span class="muted">{move || format!("{:.0} kcal", kcal())}</span>
            </div>
            <ul class="list">
                <For
                    each=move || entries.get()
                    key=|e: &Entry| e.id
                    children=move |e: Entry| {
                        let m = e.food.macros_for(e.grams);
                        let name = e.food.title();
                        let id = e.id;
                        view! {
                            <li class="row">
                                <div class="grow">
                                    <div>{name.clone()}</div>
                                    <div class="muted small">
                                        {format!("{:.0} g · P {:.0} · C {:.0} · F {:.0}", e.grams, m.protein, m.carbs, m.fat)}
                                    </div>
                                </div>
                                <span class="kcal-pill">{format!("{:.0}", m.kcal)}</span>
                                <button
                                    class="icon-btn danger"
                                    aria-label=format!("Remove {name}")
                                    on:click=move |_| {
                                        c.db.update(|db| db.remove_entry(id));
                                        flash("Removed");
                                    }
                                >"✕"</button>
                            </li>
                        }
                    }
                />
            </ul>
            <button
                class="btn ghost"
                on:click=move |_| {
                    c.meal.set(meal);
                    c.tab.set(Tab::Add);
                }
            >{format!("+ Add to {}", meal.label())}</button>
        </section>
    }
}

// ---------- Add food ----------

#[component]
fn AddFood() -> impl IntoView {
    let c = ctx();
    let scanning = RwSignal::new(false);
    let barcode = RwSignal::new(String::new());
    let query = RwSignal::new(String::new());
    let status = RwSignal::new(String::new());
    let busy = RwSignal::new(false);
    let results = RwSignal::new(Vec::<Food>::new());
    // Some(barcode or "") = show the custom food form.
    let custom_for = RwSignal::new(None::<String>);
    // Show the "Estimate with AI" card (prefilled with this text).
    let ai_for = RwSignal::new(None::<String>);
    let ai_result = RwSignal::new(None::<Estimate>);
    let has_server = server::config().is_some();

    let look_up = move |code: String| {
        let code: String = code.chars().filter(char::is_ascii_digit).collect();
        if code.len() < 8 {
            status.set("Barcodes are 8 to 13 digits.".into());
            return;
        }
        if let Some(food) = c.db.with_untracked(|db| db.find_food(&code)) {
            c.picked.set(Some(food));
            return;
        }
        busy.set(true);
        status.set(format!("Looking up {code}…"));
        spawn_local(async move {
            match off::lookup(&code).await {
                Ok(Some(food)) => {
                    status.set(String::new());
                    c.picked.set(Some(food));
                }
                Ok(None) => {
                    // Second chance: USDA's database of US branded foods.
                    let usda = if has_server {
                        server::usda(&code, true)
                            .await
                            .ok()
                            .and_then(|v| v.into_iter().next())
                    } else {
                        None
                    };
                    match usda {
                        Some(mut food) => {
                            food.id = code;
                            status.set(String::new());
                            c.picked.set(Some(food));
                        }
                        None => {
                            status.set(if has_server {
                                format!("{code} isn't in the food databases yet. Snap the nutrition label and let AI read it, or type it in once.")
                            } else {
                                format!("{code} isn't in Open Food Facts yet. Enter it from the label once and it'll be saved.")
                            });
                            if has_server {
                                ai_for.set(Some(String::new()));
                            }
                            custom_for.set(Some(code));
                        }
                    }
                }
                Err(e) => status.set(e),
            }
            busy.set(false);
        });
    };

    let run_search = move || {
        let q = query.get_untracked();
        if q.trim().is_empty() {
            return;
        }
        // Check saved foods first, instantly.
        let ql = q.to_lowercase();
        let local: Vec<Food> = c.db.with_untracked(|db| {
            db.foods
                .iter()
                .filter(|f| f.title().to_lowercase().contains(&ql))
                .cloned()
                .collect()
        });
        results.set(local);
        busy.set(true);
        status.set("Searching…".into());
        ai_for.set(None);
        spawn_local(async move {
            let add = |found: Vec<Food>| {
                results.update(|r| {
                    for f in found {
                        if !r.iter().any(|x| x.id == f.id) {
                            r.push(f);
                        }
                    }
                })
            };
            // USDA first (generic foods like "banana"), then Open Food Facts (brands).
            let mut error = None;
            if has_server {
                match server::usda(&q, false).await {
                    Ok(found) => add(found),
                    Err(e) => error = Some(e),
                }
            }
            match off::search(&q).await {
                Ok(found) => add(found),
                Err(e) => error = error.or(Some(e)),
            }
            let empty = results.with_untracked(Vec::is_empty);
            status.set(match (empty, error) {
                (true, Some(e)) => e,
                (true, None) if has_server => "No matches. Let AI estimate it below.".into(),
                (true, None) => "No matches. Try fewer words, or add a custom food.".into(),
                _ => String::new(),
            });
            if has_server {
                ai_for.set(Some(q));
            }
            busy.set(false);
        });
    };

    view! {
        <header class="page-head">
            <h1>"Add food"</h1>
            <label class="inline">
                <span class="muted">"to "</span>
                <select
                    aria-label="Meal"
                    on:change=move |ev| {
                        let i: usize = event_target_value(&ev).parse().unwrap_or(0);
                        c.meal.set(Meal::ALL[i.min(3)]);
                    }
                >
                    {Meal::ALL.into_iter().enumerate().map(|(i, m)| view! {
                        <option value=i.to_string() selected=move || c.meal.get() == m>{m.label()}</option>
                    }).collect_view()}
                </select>
            </label>
        </header>

        <button class="btn primary big-btn" on:click=move |_| scanning.set(true)>
            <span aria-hidden="true">"📷 "</span>"Scan barcode"
        </button>

        <form class="card" on:submit=move |ev| { ev.prevent_default(); look_up(barcode.get_untracked()); }>
            <label for="barcode">"Or type the barcode number"</label>
            <div class="input-row">
                <input id="barcode" inputmode="numeric" autocomplete="off" placeholder="e.g. 049000028911"
                    prop:value=move || barcode.get()
                    on:input=move |ev| barcode.set(event_target_value(&ev))/>
                <button class="btn" type="submit" disabled=move || busy.get()>"Look up"</button>
            </div>
        </form>

        <form class="card" role="search" on:submit=move |ev| { ev.prevent_default(); run_search(); }>
            <label for="search">"Search foods"</label>
            <div class="input-row">
                <input id="search" type="search" placeholder="e.g. greek yogurt"
                    prop:value=move || query.get()
                    on:input=move |ev| query.set(event_target_value(&ev))/>
                <button class="btn" type="submit" disabled=move || busy.get()>"Search"</button>
            </div>
        </form>

        <p class="status" role="status" aria-live="polite">{move || status.get()}</p>

        {move || ai_for.get().map(|text| view! {
            <AiEstimate
                text=text
                on_result=Callback::new(move |e: Estimate| {
                    ai_result.set(Some(e));
                    if custom_for.get_untracked().is_none() {
                        custom_for.set(Some(String::new()));
                    }
                    ai_for.set(None);
                })
            />
        })}

        {move || custom_for.get().map(|code| view! {
            <CustomFoodForm
                barcode=code
                estimate=ai_result.get()
                on_done=Callback::new(move |_| { custom_for.set(None); ai_result.set(None); })
            />
        })}

        <Show when=move || !results.with(Vec::is_empty)>
            <section class="card" aria-label="Search results">
                <h2>"Results"</h2>
                <FoodList foods=Signal::derive(move || results.get())/>
            </section>
        </Show>

        <section class="card" aria-label="Saved foods">
            <div class="meal-head">
                <h2>"Recent & custom"</h2>
                <div>
                    {has_server.then(|| view! {
                        <button class="btn ghost small" on:click=move |_| ai_for.set(Some(query.get_untracked()))>"✨ AI estimate"</button>
                    })}
                    <button class="btn ghost small" on:click=move |_| custom_for.set(Some(String::new()))>"+ Custom food"</button>
                </div>
            </div>
            <Show
                when=move || !c.db.with(|db| db.foods.is_empty())
                fallback=|| view! { <p class="muted">"Foods you add will show up here for quick re-logging."</p> }
            >
                <FoodList foods=Signal::derive(move || c.db.with(|db| db.foods.clone()))/>
            </Show>
        </section>

        <Show when=move || scanning.get()>
            <Scanner
                on_detect=Callback::new(move |code: String| {
                    scanning.set(false);
                    barcode.set(code.clone());
                    look_up(code);
                })
                on_close=Callback::new(move |_| scanning.set(false))
            />
        </Show>
    }
}

#[component]
fn FoodList(foods: Signal<Vec<Food>>) -> impl IntoView {
    let c = ctx();
    view! {
        <ul class="list">
            <For
                each=move || foods.get()
                key=|f: &Food| f.id.clone()
                children=move |f: Food| {
                    let title = f.title();
                    let detail = match f.serving_g {
                        Some(g) => format!("{:.0} kcal per serving ({g:.0} g)", f.kcal * g / 100.0),
                        None => format!("{:.0} kcal per 100 g", f.kcal),
                    };
                    view! {
                        <li>
                            <button class="row row-btn" on:click=move |_| c.picked.set(Some(f.clone()))>
                                <div class="grow">
                                    <div>{title}</div>
                                    <div class="muted small">{detail}</div>
                                </div>
                                <span aria-hidden="true">"›"</span>
                            </button>
                        </li>
                    }
                }
            />
        </ul>
    }
}

#[component]
fn CustomFoodForm(
    barcode: String,
    estimate: Option<Estimate>,
    on_done: Callback<()>,
) -> impl IntoView {
    let c = ctx();
    // Prefill from the AI estimate, if there is one.
    let pre = |f: &dyn Fn(&Estimate) -> String| {
        RwSignal::new(estimate.as_ref().map(f).unwrap_or_default())
    };
    let num = |v: f64| format!("{}", (v * 10.0).round() / 10.0);
    let name = pre(&|e| e.name.clone());
    let brand = RwSignal::new(String::new());
    let serving = pre(&|e| num(e.serving_g));
    let kcal = pre(&|e| num(e.kcal));
    let protein = pre(&|e| num(e.protein_g));
    let carbs = pre(&|e| num(e.carbs_g));
    let fat = pre(&|e| num(e.fat_g));
    let error = RwSignal::new(String::new());
    let has_barcode = !barcode.is_empty();
    let barcode = StoredValue::new(barcode);

    let field =
        move |id: &'static str, label: &'static str, sig: RwSignal<String>, numeric: bool| {
            view! {
                <label for=id>{label}</label>
                <input id=id
                    inputmode=numeric.then_some("decimal")
                    autocomplete="off"
                    prop:value=move || sig.get()
                    on:input=move |ev| sig.set(event_target_value(&ev))/>
            }
        };

    let save = move || {
        let n = name.get_untracked().trim().to_string();
        let Some(sg) = parse_num(&serving.get_untracked()).filter(|g| *g > 0.0) else {
            error.set("Enter the serving size in grams (it's on the label).".into());
            return;
        };
        let Some(k) = parse_num(&kcal.get_untracked()) else {
            error.set("Enter the calories per serving.".into());
            return;
        };
        if n.is_empty() {
            error.set("Give the food a name.".into());
            return;
        }
        let per100 =
            |s: RwSignal<String>| parse_num(&s.get_untracked()).unwrap_or(0.0) * 100.0 / sg;
        let code = barcode.get_value();
        let food = Food {
            id: if code.is_empty() {
                format!("custom-{}", store::now_ms())
            } else {
                code
            },
            name: n,
            brand: brand.get_untracked().trim().to_string(),
            kcal: k * 100.0 / sg,
            protein: per100(protein),
            carbs: per100(carbs),
            fat: per100(fat),
            serving_g: Some(sg),
            custom: true,
        };
        c.db.update(|db| db.remember(&food));
        c.picked.set(Some(food));
        on_done.run(());
    };

    view! {
        <form class="card form" aria-label="Custom food" on:submit=move |ev| { ev.prevent_default(); save(); }>
            <h2>{if estimate.is_some() { "Check the AI estimate" } else { "New custom food" }}</h2>
            {has_barcode.then(|| view! { <p class="muted small">{format!("Barcode {}", barcode.get_value())}</p> })}
            {match &estimate {
                Some(e) => view! {
                    <p class="ai-note">
                        <strong>{format!("{} · {} confidence", e.serving_description, e.confidence)}</strong>
                        <br/>{e.notes.clone()}<br/>
                        <span class="muted small">"Fix anything that looks off, then save."</span>
                    </p>
                }.into_any(),
                None => view! { <p class="muted small">"Copy these from the nutrition label (per serving)."</p> }.into_any(),
            }}
            {field("cf-name", "Name", name, false)}
            {field("cf-brand", "Brand (optional)", brand, false)}
            {field("cf-serving", "Serving size (g)", serving, true)}
            {field("cf-kcal", "Calories", kcal, true)}
            {field("cf-protein", "Protein (g)", protein, true)}
            {field("cf-carbs", "Carbs (g)", carbs, true)}
            {field("cf-fat", "Fat (g)", fat, true)}
            <p class="error" role="alert">{move || error.get()}</p>
            <div class="input-row">
                <button class="btn ghost" type="button" on:click=move |_| on_done.run(())>"Cancel"</button>
                <button class="btn primary" type="submit">"Save food"</button>
            </div>
        </form>
    }
}

// ---------- Amount sheet ----------

#[component]
fn AmountSheet() -> impl IntoView {
    let c = ctx();
    let food = c.picked.get_untracked().unwrap_or_default();
    let serving_g = food.serving_g;
    // Default to 1 serving if we know the size, otherwise 100 g.
    let by_serving = RwSignal::new(serving_g.is_some());
    let amount = RwSignal::new(if serving_g.is_some() {
        "1".to_string()
    } else {
        "100".to_string()
    });
    let grams = Memo::new(move |_| {
        let a = parse_num(&amount.get()).unwrap_or(0.0);
        match (by_serving.get(), serving_g) {
            (true, Some(g)) => a * g,
            _ => a,
        }
    });
    let food = StoredValue::new(food);
    let macros = move || food.with_value(|f| f.macros_for(grams.get()));
    let close = move || c.picked.set(None);

    let add = move || {
        let g = grams.get_untracked();
        if g <= 0.0 {
            return;
        }
        let f = food.get_value();
        let entry = Entry {
            id: store::now_ms(),
            date: store::date_string(c.day.get_untracked()),
            meal: c.meal.get_untracked(),
            food: f.clone(),
            grams: g,
        };
        c.db.update(|db| {
            db.entries.push(entry);
            db.remember(&f);
        });
        c.picked.set(None);
        c.tab.set(Tab::Diary);
        flash(format!("Added to {}", c.meal.get_untracked().label()));
    };

    view! {
        <div class="backdrop" on:click=move |_| close()></div>
        <form class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"
            on:submit=move |ev| { ev.prevent_default(); add(); }>
            <h2 id="sheet-title">{food.with_value(|f| f.title())}</h2>
            <MacroLine m=Signal::derive(macros)/>
            <label for="amount">"How much?"</label>
            <div class="input-row">
                <input id="amount" inputmode="decimal" autocomplete="off"
                    prop:value=move || amount.get()
                    on:input=move |ev| amount.set(event_target_value(&ev))/>
                {serving_g.map(|g| view! {
                    <div class="seg" role="group" aria-label="Unit">
                        <button type="button" class:active=move || by_serving.get()
                            aria-pressed=move || by_serving.get().to_string()
                            on:click=move |_| { by_serving.set(true); amount.set("1".into()); }>
                            {format!("servings ({g:.0} g)")}
                        </button>
                        <button type="button" class:active=move || !by_serving.get()
                            aria-pressed=move || (!by_serving.get()).to_string()
                            on:click=move |_| { by_serving.set(false); amount.set(format!("{g:.0}")); }>
                            "grams"
                        </button>
                    </div>
                })}
                {serving_g.is_none().then(|| view! { <span class="muted">"grams"</span> })}
            </div>
            <label>"Meal"</label>
            <div class="seg wide" role="group" aria-label="Meal">
                {Meal::ALL.into_iter().map(|m| view! {
                    <button type="button" class:active=move || c.meal.get() == m
                        aria-pressed=move || (c.meal.get() == m).to_string()
                        on:click=move |_| c.meal.set(m)>{m.label()}</button>
                }).collect_view()}
            </div>
            <div class="input-row">
                <button class="btn ghost" type="button" on:click=move |_| close()>"Cancel"</button>
                <button class="btn primary" type="submit">
                    {move || format!("Add to {}", day_label(c.day.get()).to_lowercase())}
                </button>
            </div>
        </form>
    }
}

#[component]
fn MacroLine(m: Signal<Macros>) -> impl IntoView {
    view! {
        <div class="macro-line">
            <div><strong>{move || format!("{:.0}", m.get().kcal)}</strong><span>"kcal"</span></div>
            <div><strong>{move || format!("{:.1}", m.get().protein)}</strong><span>"protein g"</span></div>
            <div><strong>{move || format!("{:.1}", m.get().carbs)}</strong><span>"carbs g"</span></div>
            <div><strong>{move || format!("{:.1}", m.get().fat)}</strong><span>"fat g"</span></div>
        </div>
    }
}

// ---------- Settings ----------

#[component]
fn Settings() -> impl IntoView {
    let c = ctx();
    let backup = RwSignal::new(String::new());
    let restore_msg = RwSignal::new(String::new());

    let goal =
        move |id: &'static str, label: &'static str, get: fn(&Db) -> f64, set: fn(&mut Db, f64)| {
            view! {
                <label for=id>{label}</label>
                <input id=id inputmode="decimal"
                    prop:value=move || format!("{:.0}", c.db.with(get))
                    on:change=move |ev| {
                        if let Some(v) = parse_num(&event_target_value(&ev)) {
                            c.db.update(|db| {
                                set(db, v);
                                db.goals_updated = store::now_ms();
                            });
                        }
                    }/>
            }
        };

    view! {
        <header class="page-head"><h1>"Settings"</h1></header>
        <section class="card form" aria-label="Daily goals">
            <h2>"Daily goals"</h2>
            {goal("g-kcal", "Calories (kcal)", |d| d.goals.kcal, |d, v| d.goals.kcal = v)}
            {goal("g-protein", "Protein (g)", |d| d.goals.protein, |d, v| d.goals.protein = v)}
            {goal("g-carbs", "Carbs (g)", |d| d.goals.carbs, |d, v| d.goals.carbs = v)}
            {goal("g-fat", "Fat (g)", |d| d.goals.fat, |d, v| d.goals.fat = v)}
        </section>

        <ServerSettings/>

        <section class="card form" aria-label="Backup">
            <h2>"Backup"</h2>
            <p class="muted small">
                "Copy a backup now and then (e.g. into Notes), and paste it here to restore. Without a sync server, your log lives only on this phone."
            </p>
            <div class="input-row">
                <button class="btn" type="button"
                    on:click=move |_| backup.set(c.db.with(|db| serde_json::to_string(db).unwrap_or_default()))>
                    "Show backup"
                </button>
                <button class="btn" type="button" on:click=move |_| {
                    match serde_json::from_str::<Db>(&backup.get_untracked()) {
                        Ok(db) => {
                            let n = db.entries.len();
                            c.db.update(|cur| *cur = cur.merge(&db));
                            restore_msg.set(format!("Restored {n} entries."));
                        }
                        Err(_) => restore_msg.set("That doesn't look like a FoodLog backup.".into()),
                    }
                }>"Restore from box"</button>
            </div>
            <label for="backup">"Backup data"</label>
            <textarea id="backup" rows="4"
                prop:value=move || backup.get()
                on:input=move |ev| backup.set(event_target_value(&ev))></textarea>
            <p class="status" role="status">{move || restore_msg.get()}</p>
        </section>

        <p class="muted small credits">
            "Food data from "
            <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">"Open Food Facts"</a>
            " (ODbL) and "
            <a href="https://fdc.nal.usda.gov" target="_blank" rel="noopener">"USDA FoodData Central"</a>
            ". Missing a product? You can add it to Open Food Facts too."
        </p>
    }
}

#[component]
fn ServerSettings() -> impl IntoView {
    let c = ctx();
    let saved = server::config().unwrap_or_default();
    let url = RwSignal::new(saved.url);
    let password = RwSignal::new(saved.password);
    let save = move || {
        server::save_config(&server::Config {
            url: url.get_untracked().trim().to_string(),
            password: password.get_untracked(),
        });
        c.sync_nudge.update(|n| *n += 1);
    };
    view! {
        <form class="card form" aria-label="Sync and AI server"
            on:submit=move |ev| { ev.prevent_default(); save(); }>
            <h2>"Sync & AI"</h2>
            <p class="muted small">
                "Your FoodLog server (see the README) syncs your log between devices and powers AI estimates."
            </p>
            <label for="srv-url">"Server address"</label>
            <input id="srv-url" type="url" autocomplete="off" autocapitalize="off"
                placeholder="https://foodlog.yourname.workers.dev"
                prop:value=move || url.get()
                on:input=move |ev| url.set(event_target_value(&ev))/>
            <label for="srv-pass">"Password"</label>
            <input id="srv-pass" type="password" autocomplete="current-password"
                prop:value=move || password.get()
                on:input=move |ev| password.set(event_target_value(&ev))/>
            <div class="input-row">
                <span class="status grow" role="status">{move || c.sync_status.get()}</span>
                <button class="btn primary" type="submit">"Save & sync"</button>
            </div>
        </form>
    }
}

/// Describe a food and/or add a photo; Claude estimates its nutrition.
#[component]
fn AiEstimate(text: String, on_result: Callback<Estimate>) -> impl IntoView {
    let text = RwSignal::new(text);
    let photo = RwSignal::new(None::<SendWrapper<web_sys::File>>);
    let busy = RwSignal::new(false);
    let error = RwSignal::new(String::new());
    let file_ref = NodeRef::<leptos::html::Input>::new();

    let go = move || {
        let file = photo.get_untracked().map(SendWrapper::take);
        let t = text.get_untracked();
        if t.trim().is_empty() && file.is_none() {
            error.set("Describe what you ate, or add a photo.".into());
            return;
        }
        busy.set(true);
        error.set(String::new());
        spawn_local(async move {
            let image = match file {
                Some(f) => match photo::prepare(f).await {
                    Ok(img) => Some(img),
                    Err(e) => {
                        error.set(e);
                        busy.set(false);
                        return;
                    }
                },
                None => None,
            };
            match server::estimate(&EstimateRequest { text: t, image }).await {
                Ok(est) => on_result.run(est),
                Err(e) => error.set(e),
            }
            busy.set(false);
        });
    };

    view! {
        <form class="card form ai" aria-label="AI estimate" on:submit=move |ev| { ev.prevent_default(); go(); }>
            <h2>"✨ Estimate with AI"</h2>
            <label for="ai-text">"What did you eat?"</label>
            <textarea id="ai-text" rows="2" placeholder="e.g. Chipotle chicken bowl with white rice, beans and guac"
                prop:value=move || text.get()
                on:input=move |ev| text.set(event_target_value(&ev))></textarea>
            <label for="ai-photo">"Photo (optional): the nutrition label or your plate"</label>
            <input id="ai-photo" type="file" accept="image/*" node_ref=file_ref
                on:change=move |_| {
                    let f = file_ref.get().and_then(|i| i.files()).and_then(|fs| fs.get(0));
                    photo.set(f.map(SendWrapper::new));
                }/>
            <p class="error" role="alert">{move || error.get()}</p>
            <div class="input-row">
                <button class="btn primary" type="submit" disabled=move || busy.get()>
                    {move || if busy.get() { "Estimating…" } else { "Estimate" }}
                </button>
            </div>
        </form>
    }
}
