// Same data format as the web app (foodlog-core/src/model.rs), so both can
// share one log through the sync server.

export type Meal = 'Breakfast' | 'Lunch' | 'Dinner' | 'Snacks';
export const MEALS: Meal[] = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];

/** Nutrition per 100 g. */
export interface Food {
  id: string; // barcode, or custom-<ms>
  name: string;
  brand: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  serving_g: number | null;
  /** What one serving is, e.g. "1 breast" or "1 cup, chopped". */
  serving_label?: string;
  custom: boolean;
}

export interface Entry {
  id: number;
  date: string; // YYYY-MM-DD
  meal: Meal;
  food: Food;
  grams: number;
}

export interface Goals {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface Exercise {
  name: string;
  video?: string | null;
  technique: string;
  warmup_sets: string;
  working_sets: number;
  reps: string;
  early_rpe: string;
  last_rpe: string;
  rest: string;
  substitutions: string[];
  notes: string;
}
export interface Day {
  name: string;
  exercises: Exercise[];
}
export interface Week {
  number: number;
  block: string;
  days: Day[];
}
export interface Program {
  name: string;
  weeks: Week[];
}

export interface LoggedSet {
  id: number;
  date: string; // "" for sets imported from a spreadsheet
  exercise: string;
  weight: number;
  reps: number;
  week: number | null;
  day: string;
}

/** One body weight reading. */
export interface WeighIn {
  id: number;
  date: string; // YYYY-MM-DD
  lb: number;
}

export interface Profile {
  name: string;
  birth_year: number | null;
  height_in: number | null;
  sex: '' | 'male' | 'female';
  goal_weight_lb: number | null;
}

export const EMPTY_PROFILE: Profile = { name: '', birth_year: null, height_in: null, sex: '', goal_weight_lb: null };

export interface Db {
  entries: Entry[];
  foods: Food[];
  goals: Goals;
  goals_updated: number;
  deleted: number[];
  program: Program | null;
  program_updated: number;
  sets: LoggedSet[];
  deleted_sets: number[];
  weights: WeighIn[];
  deleted_weights: number[];
  profile: Profile;
  profile_updated: number;
}

export interface Macros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export const DEFAULT_GOALS: Goals = { kcal: 2000, protein: 150, carbs: 200, fat: 65 };

export function emptyDb(): Db {
  return {
    entries: [],
    foods: [],
    goals: { ...DEFAULT_GOALS },
    goals_updated: 0,
    deleted: [],
    program: null,
    program_updated: 0,
    sets: [],
    deleted_sets: [],
    weights: [],
    deleted_weights: [],
    profile: { ...EMPTY_PROFILE },
    profile_updated: 0,
  };
}

/** Fill in anything missing (older saves, or saves from the web app). */
export function normalizeDb(raw: unknown): Db {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Partial<Db>;
  const base = emptyDb();
  return {
    entries: d.entries ?? base.entries,
    foods: (d.foods ?? []).map((f) => ({ ...f, brand: f.brand ?? '', serving_g: f.serving_g ?? null, custom: !!f.custom })),
    goals: d.goals ?? base.goals,
    goals_updated: d.goals_updated ?? 0,
    deleted: d.deleted ?? [],
    program: d.program ?? null,
    program_updated: d.program_updated ?? 0,
    sets: (d.sets ?? []).map((s) => ({ ...s, week: s.week ?? null, day: s.day ?? '' })),
    deleted_sets: d.deleted_sets ?? [],
    weights: d.weights ?? [],
    deleted_weights: d.deleted_weights ?? [],
    profile: { ...EMPTY_PROFILE, ...(d.profile ?? {}) },
    profile_updated: d.profile_updated ?? 0,
  };
}

export function foodTitle(f: Food): string {
  return f.brand ? `${f.name} · ${f.brand}` : f.name;
}

export function macrosFor(f: Food, grams: number): Macros {
  const k = grams / 100;
  return { kcal: f.kcal * k, protein: f.protein * k, carbs: f.carbs * k, fat: f.fat * k };
}

export function addMacros(a: Macros, b: Macros): Macros {
  return { kcal: a.kcal + b.kcal, protein: a.protein + b.protein, carbs: a.carbs + b.carbs, fat: a.fat + b.fat };
}

export const ZERO: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

export function dayTotals(db: Db, date: string): Macros {
  return db.entries.filter((e) => e.date === date).reduce((acc, e) => addMacros(acc, macrosFor(e.food, e.grams)), ZERO);
}

export function mealForHour(h: number): Meal {
  if (h >= 4 && h <= 10) return 'Breakfast';
  if (h >= 11 && h <= 15) return 'Lunch';
  if (h >= 16 && h <= 21) return 'Dinner';
  return 'Snacks';
}

/** Put a food at the front of the saved list. Every food you log is kept, so it's instant next time. */
export function remember(db: Db, food: Food): Db {
  return { ...db, foods: [food, ...db.foods.filter((f) => f.id !== food.id)] };
}

/** How many times each food has been logged, by food id. */
export function timesLogged(db: Db): Map<string, number> {
  const n = new Map<string, number>();
  for (const e of db.entries) n.set(e.food.id, (n.get(e.food.id) ?? 0) + 1);
  return n;
}

function union(a: number[], b: number[]): number[] {
  return [...new Set([...a, ...b])].sort((x, y) => x - y);
}

/** Combine two copies of the log. Nothing added on either side is lost, removals win, newest goals/program win. */
export function mergeDb(a: Db, b: Db): Db {
  const deleted = union(a.deleted, b.deleted);
  const entries: Entry[] = [];
  for (const e of [...a.entries, ...b.entries]) {
    if (!deleted.includes(e.id) && !entries.some((x) => x.id === e.id)) entries.push(e);
  }
  entries.sort((x, y) => x.id - y.id);

  const foods: Food[] = [];
  for (const f of [...a.foods, ...b.foods]) if (!foods.some((x) => x.id === f.id)) foods.push(f);

  const deleted_sets = union(a.deleted_sets, b.deleted_sets);
  const sets: LoggedSet[] = [];
  for (const s of [...a.sets, ...b.sets]) {
    if (!deleted_sets.includes(s.id) && !sets.some((x) => x.id === s.id)) sets.push(s);
  }
  sets.sort((x, y) => x.id - y.id);

  const deleted_weights = union(a.deleted_weights, b.deleted_weights);
  const weights: WeighIn[] = [];
  for (const w of [...a.weights, ...b.weights]) {
    if (!deleted_weights.includes(w.id) && !weights.some((x) => x.id === w.id)) weights.push(w);
  }
  weights.sort((x, y) => x.id - y.id);

  const goalsFromB = b.goals_updated > a.goals_updated;
  const profileFromB = b.profile_updated > a.profile_updated;
  const programFromB = b.program_updated > a.program_updated;
  return {
    entries,
    foods,
    goals: goalsFromB ? b.goals : a.goals,
    goals_updated: goalsFromB ? b.goals_updated : a.goals_updated,
    deleted,
    program: programFromB ? b.program : a.program,
    program_updated: programFromB ? b.program_updated : a.program_updated,
    sets,
    deleted_sets,
    weights,
    deleted_weights,
    profile: profileFromB ? b.profile : a.profile,
    profile_updated: profileFromB ? b.profile_updated : a.profile_updated,
  };
}

export function dateString(offsetDays = 0): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Unique enough across devices: milliseconds plus a random tail (same scheme as the web app). */
export function newId(): number {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}
