//! Screens: Diary, Add food, Settings, plus the "how much?" sheet.

use leptos::{prelude::*, task::spawn_local};

use crate::{
    model::{Db, Entry, Food, Macros, Meal},
    off,
    scanner::Scanner,
    store,
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
    };
    provide_context(c);
    // Save whenever anything changes.
    Effect::new(move |_| c.db.with(store::save));

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
                                        c.db.update(|db| db.entries.retain(|x| x.id != id));
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
                    status.set(format!("{code} isn't in Open Food Facts yet. Enter it from the label once and it'll be saved."));
                    custom_for.set(Some(code));
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
        spawn_local(async move {
            match off::search(&q).await {
                Ok(found) => {
                    let n = found.len();
                    results.update(|r| {
                        for f in found {
                            if !r.iter().any(|x| x.id == f.id) {
                                r.push(f);
                            }
                        }
                    });
                    status.set(if n == 0 && results.with_untracked(Vec::is_empty) {
                        "No matches. Try fewer words, or add a custom food.".into()
                    } else {
                        String::new()
                    });
                }
                Err(e) => status.set(e),
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

        {move || custom_for.get().map(|code| view! {
            <CustomFoodForm barcode=code on_done=Callback::new(move |_| custom_for.set(None))/>
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
                <button class="btn ghost small" on:click=move |_| custom_for.set(Some(String::new()))>"+ Custom food"</button>
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
fn CustomFoodForm(barcode: String, on_done: Callback<()>) -> impl IntoView {
    let c = ctx();
    let name = RwSignal::new(String::new());
    let brand = RwSignal::new(String::new());
    let serving = RwSignal::new(String::new());
    let kcal = RwSignal::new(String::new());
    let protein = RwSignal::new(String::new());
    let carbs = RwSignal::new(String::new());
    let fat = RwSignal::new(String::new());
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
            <h2>"New custom food"</h2>
            {has_barcode.then(|| view! { <p class="muted small">{format!("Barcode {}", barcode.get_value())}</p> })}
            <p class="muted small">"Copy these from the nutrition label (per serving)."</p>
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
                            c.db.update(|db| set(db, v));
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

        <section class="card form" aria-label="Backup">
            <h2>"Backup"</h2>
            <p class="muted small">
                "Your log lives only on this phone. Copy a backup now and then (e.g. into Notes), and paste it here to restore."
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
                            c.db.set(db);
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
            " (ODbL). Missing a product? You can add it there too."
        </p>
    }
}
