// Coach's local index: your log, organised on the phone so any AI model can
// look things up with tools instead of being sent everything at once.
// Nothing here talks to the network; the AI only sees what a tool returns.
import { Db, Entry, LoggedSet, dateString, foodTitle, macrosFor } from './model';
import { e1rm, fmtSet, records, sameExercise, upNext } from './workout';
import type { Activity } from './coach';

/** A tool in a provider-neutral shape (JSON Schema parameters). */
export interface CoachTool {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required: string[]; additionalProperties: false };
}

const r = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function obj(properties: Record<string, unknown>, required: string[] = []): CoachTool['parameters'] {
  return { type: 'object', properties, required, additionalProperties: false };
}
const dateProp = (what: string) => ({ type: 'string', description: `${what} date, YYYY-MM-DD` });

export const COACH_TOOLS: CoachTool[] = [
  {
    name: 'get_overview',
    description: "Today's date, daily goals, today's totals, Apple Health activity, the training program and the next workout. Call this first.",
    parameters: obj({}),
  },
  {
    name: 'get_meals',
    description: 'Every food logged between two dates (inclusive, max 31 days), grouped by day and meal, with grams and macros.',
    parameters: obj({ start_date: dateProp('First'), end_date: dateProp('Last') }, ['start_date', 'end_date']),
  },
  {
    name: 'get_nutrition_trends',
    description: 'Daily calorie and macro totals for the last N days (max 90), plus averages over logged days and the goals.',
    parameters: obj({ days: { type: 'integer', description: 'How many days back, including today' } }, ['days']),
  },
  {
    name: 'search_foods',
    description: 'Find foods by name in saved foods and the log. Shows nutrition per 100 g and per serving, and how often and when each was eaten.',
    parameters: obj({ query: { type: 'string', description: 'Words in the food name or brand' } }, ['query']),
  },
  {
    name: 'list_exercises',
    description: 'Every exercise ever logged, with heaviest set, best estimated 1RM, number of sets and last date.',
    parameters: obj({}),
  },
  {
    name: 'get_exercise_history',
    description: 'All logged sets for one exercise (partial names match), oldest first, with estimated 1RM per set.',
    parameters: obj({ exercise: { type: 'string', description: 'Exercise name, e.g. "bench press"' } }, ['exercise']),
  },
  {
    name: 'get_workouts',
    description: 'Workout sessions (sets grouped by day) between two dates, inclusive.',
    parameters: obj({ start_date: dateProp('First'), end_date: dateProp('Last') }, ['start_date', 'end_date']),
  },
  {
    name: 'get_program_day',
    description: 'What the program prescribes for one day: exercises, sets, reps, RPE, rest, substitutions and notes. Day is the day name (e.g. "Push #1") or 1-based number.',
    parameters: obj({ week: { type: 'integer', description: 'Program week number' }, day: { type: 'string', description: 'Day name or number' } }, ['week', 'day']),
  },
];

export class CoachIndex {
  private byDate = new Map<string, Entry[]>();
  private setsByExercise = new Map<string, LoggedSet[]>();

  constructor(private db: Db, private activity: Activity | null) {
    for (const e of db.entries) this.byDate.set(e.date, [...(this.byDate.get(e.date) ?? []), e]);
    for (const s of db.sets) {
      const k = s.exercise.trim().toLowerCase().split(/\s+/).join(' ');
      this.setsByExercise.set(k, [...(this.setsByExercise.get(k) ?? []), s]);
    }
  }

  /** Run a tool by name. Always returns text for the model (errors included). */
  run(name: string, input: Record<string, unknown>): string {
    try {
      const fn = (this as unknown as Record<string, (i: Record<string, unknown>) => unknown>)[`t_${name}`];
      if (typeof fn !== 'function') return `Error: unknown tool ${name}`;
      return JSON.stringify(fn.call(this, input ?? {}));
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
  }

  private totals(date: string) {
    const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    for (const e of this.byDate.get(date) ?? []) {
      const m = macrosFor(e.food, e.grams);
      t.kcal += m.kcal;
      t.protein += m.protein;
      t.carbs += m.carbs;
      t.fat += m.fat;
    }
    return { kcal: r(t.kcal), protein_g: r(t.protein), carbs_g: r(t.carbs), fat_g: r(t.fat) };
  }

  private range(input: Record<string, unknown>, max: number): string[] {
    const a = String(input.start_date ?? '');
    const b = String(input.end_date ?? '');
    if (!DAY.test(a) || !DAY.test(b)) throw new Error('dates must be YYYY-MM-DD');
    const out: string[] = [];
    const d = new Date(`${a}T12:00:00`);
    const end = new Date(`${b}T12:00:00`);
    while (d <= end && out.length < max) {
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  private setOut(s: LoggedSet) {
    return { date: s.date || null, week: s.week, day: s.day || null, weight_lb: s.weight, reps: s.reps, est_1rm_lb: r1(e1rm(s)) };
  }

  t_get_overview() {
    const p = this.db.program;
    const next = p ? upNext(p, this.db.sets) : null;
    const nextDay = p && next ? p.weeks.find((w) => w.number === next.week)?.days[next.day] : undefined;
    return {
      today: dateString(0),
      weekday: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
      goals: { kcal: this.db.goals.kcal, protein_g: this.db.goals.protein, carbs_g: this.db.goals.carbs, fat_g: this.db.goals.fat },
      today_totals: this.totals(dateString(0)),
      apple_health_today: this.activity ? { steps: r(this.activity.steps), active_kcal: r(this.activity.active) } : 'not available',
      days_with_food_logged: this.byDate.size,
      sets_logged: this.db.sets.length,
      program: p ? { name: p.name, weeks: p.weeks.length, days_per_week: p.weeks[0]?.days.map((d) => d.name) ?? [] } : null,
      up_next: nextDay ? { week: next!.week, day: nextDay.name, exercises: nextDay.exercises.map((x) => x.name) } : null,
      units: 'weights in lb, food in grams',
    };
  }

  t_get_meals(input: Record<string, unknown>) {
    return this.range(input, 31)
      .filter((d) => this.byDate.has(d))
      .map((date) => ({
        date,
        totals: this.totals(date),
        foods: (this.byDate.get(date) ?? []).map((e) => {
          const m = macrosFor(e.food, e.grams);
          return { meal: e.meal, food: foodTitle(e.food), grams: r(e.grams), kcal: r(m.kcal), protein_g: r1(m.protein), carbs_g: r1(m.carbs), fat_g: r1(m.fat) };
        }),
      }));
  }

  t_get_nutrition_trends(input: Record<string, unknown>) {
    const n = Math.min(90, Math.max(1, Number(input.days) || 7));
    const days = [];
    for (let i = -(n - 1); i <= 0; i++) {
      const date = dateString(i);
      days.push({ date, logged: this.byDate.has(date), ...this.totals(date) });
    }
    const logged = days.filter((d) => d.logged);
    const avg = (k: 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g') => (logged.length ? r(logged.reduce((a, d) => a + d[k], 0) / logged.length) : null);
    return {
      goals: { kcal: this.db.goals.kcal, protein_g: this.db.goals.protein, carbs_g: this.db.goals.carbs, fat_g: this.db.goals.fat },
      days_logged: logged.length,
      average_on_logged_days: { kcal: avg('kcal'), protein_g: avg('protein_g'), carbs_g: avg('carbs_g'), fat_g: avg('fat_g') },
      days,
    };
  }

  t_search_foods(input: Record<string, unknown>) {
    const words = String(input.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) throw new Error('query is empty');
    const hits = new Map<string, { title: string; per100: object; serving_g: number | null; times_logged: number; last_eaten: string | null }>();
    const consider = (f: Entry['food'], date?: string) => {
      const title = foodTitle(f);
      if (!words.every((w) => title.toLowerCase().includes(w))) return;
      const h = hits.get(f.id) ?? {
        title,
        per100: { kcal: r(f.kcal), protein_g: r1(f.protein), carbs_g: r1(f.carbs), fat_g: r1(f.fat) },
        serving_g: f.serving_g,
        times_logged: 0,
        last_eaten: null,
      };
      if (date) {
        h.times_logged += 1;
        if (!h.last_eaten || date > h.last_eaten) h.last_eaten = date;
      }
      hits.set(f.id, h);
    };
    this.db.foods.forEach((f) => consider(f));
    this.db.entries.forEach((e) => consider(e.food, e.date));
    return [...hits.values()].sort((a, b) => b.times_logged - a.times_logged).slice(0, 15);
  }

  t_list_exercises() {
    return records(this.db.sets).map((rec) => {
      const dated = this.db.sets.filter((s) => s.date && sameExercise(s.exercise, rec.exercise)).map((s) => s.date);
      return {
        exercise: rec.exercise,
        heaviest: fmtSet(rec.heaviest),
        best_est_1rm_lb: r1(e1rm(rec.best)),
        sets: rec.total,
        last_date: dated.length ? dated.sort().at(-1) : null,
      };
    });
  }

  t_get_exercise_history(input: Record<string, unknown>) {
    const q = String(input.exercise ?? '').trim().toLowerCase();
    if (!q) throw new Error('exercise is empty');
    const names = [...this.setsByExercise.keys()];
    const match = names.find((n) => n === q) ?? names.find((n) => n.includes(q)) ?? names.find((n) => q.split(/\s+/).every((w) => n.includes(w)));
    if (!match) return { found: false, known_exercises: names.slice(0, 60) };
    const sets = [...(this.setsByExercise.get(match) ?? [])].sort(
      (a, b) => (a.date || '0').localeCompare(b.date || '0') || (a.week ?? 0) - (b.week ?? 0) || a.id - b.id,
    );
    return { exercise: sets[0]?.exercise ?? match, sets: sets.slice(-120).map((s) => this.setOut(s)) };
  }

  t_get_workouts(input: Record<string, unknown>) {
    const days = new Set(this.range(input, 120));
    const groups = new Map<string, LoggedSet[]>();
    for (const s of this.db.sets) {
      if (!s.date || !days.has(s.date)) continue;
      const k = `${s.date}|${s.day}`;
      groups.set(k, [...(groups.get(k) ?? []), s]);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, sets]) => {
        const [date, day] = k.split('|');
        const ex = new Map<string, string[]>();
        for (const s of sets) ex.set(s.exercise, [...(ex.get(s.exercise) ?? []), fmtSet(s)]);
        return { date, day: day || null, exercises: [...ex.entries()].map(([name, list]) => ({ name, sets_lb_x_reps: list })) };
      });
  }

  t_get_program_day(input: Record<string, unknown>) {
    const p = this.db.program;
    if (!p) return { error: 'no program imported' };
    const week = p.weeks.find((w) => w.number === Number(input.week));
    if (!week) return { error: `no week ${input.week}; weeks are 1-${p.weeks.length}` };
    const want = String(input.day ?? '').trim().toLowerCase();
    const idx = Number(want);
    const day = Number.isInteger(idx) && idx >= 1 ? week.days[idx - 1] : week.days.find((d) => d.name.toLowerCase().includes(want));
    if (!day) return { error: `no such day; days are ${week.days.map((d) => d.name).join(', ')}` };
    return {
      week: week.number,
      block: week.block,
      day: day.name,
      exercises: day.exercises.map((x) => ({
        name: x.name,
        warmup_sets: x.warmup_sets,
        working_sets: x.working_sets,
        reps: x.reps,
        early_set_rpe: x.early_rpe,
        last_set_rpe: x.last_rpe,
        rest: x.rest,
        technique: x.technique,
        substitutions: x.substitutions,
        notes: x.notes,
      })),
    };
  }
}
