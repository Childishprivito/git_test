// Personal records and program progress (mirrors foodlog-core/src/workout.rs).
import type { LoggedSet, Program } from './model';

const norm = (s: string) => s.trim().split(/\s+/).join(' ').toLowerCase();
export const sameExercise = (a: string, b: string) => norm(a) === norm(b);

/** Estimated one-rep max (Epley). */
export function e1rm(s: LoggedSet): number {
  if (s.reps <= 0) return 0;
  if (s.reps === 1) return s.weight;
  return s.weight * (1 + s.reps / 30);
}

export interface Record {
  exercise: string;
  heaviest: LoggedSet;
  best: LoggedSet; // best estimated 1RM
  total: number;
}

export function records(sets: LoggedSet[]): Record[] {
  const out: Record[] = [];
  for (const s of sets) {
    if (s.reps <= 0) continue;
    const r = out.find((x) => sameExercise(x.exercise, s.exercise));
    if (!r) {
      out.push({ exercise: s.exercise, heaviest: s, best: s, total: 1 });
      continue;
    }
    r.total += 1;
    if (s.weight > r.heaviest.weight || (s.weight === r.heaviest.weight && s.reps > r.heaviest.reps)) r.heaviest = s;
    if (e1rm(s) > e1rm(r.best)) r.best = s;
  }
  return out.sort((a, b) => a.exercise.toLowerCase().localeCompare(b.exercise.toLowerCase()));
}

export function prFlags(s: LoggedSet, history: LoggedSet[]): { weight: boolean; e1rm: boolean } {
  const past = history.filter((h) => h.id !== s.id && h.reps > 0 && sameExercise(h.exercise, s.exercise));
  if (!past.length || s.reps <= 0) return { weight: false, e1rm: false };
  return {
    weight: s.weight > Math.max(...past.map((p) => p.weight)),
    e1rm: e1rm(s) > Math.max(...past.map(e1rm)) + 1e-9,
  };
}

/** Sets from the most recent session of an exercise. */
export function lastSession(exercise: string, sets: LoggedSet[]): LoggedSet[] {
  const mine = sets.filter((s) => sameExercise(s.exercise, exercise));
  mine.sort((a, b) => a.date.localeCompare(b.date) || (a.week ?? 0) - (b.week ?? 0) || a.id - b.id);
  const last = mine[mine.length - 1];
  if (!last) return [];
  return mine.filter((s) => s.date === last.date && s.week === last.week && s.day === last.day);
}

export const dayDone = (sets: LoggedSet[], week: number, day: string) => sets.some((s) => s.week === week && s.day === day);

/** First unfinished day, starting from the latest week trained in. */
export function upNext(p: Program, sets: LoggedSet[]): { week: number; day: number } | null {
  let latest = 0;
  p.weeks.forEach((w, i) => {
    if (w.days.some((d) => dayDone(sets, w.number, d.name))) latest = i;
  });
  for (const w of p.weeks.slice(latest)) {
    const i = w.days.findIndex((d) => !dayDone(sets, w.number, d.name));
    if (i >= 0) return { week: w.number, day: i };
  }
  return null;
}

/** "135 - 8", "155 -6", "60 12" -> [weight, reps]. */
export function parseLoadReps(s: string): [number, number] | null {
  const nums = s.split(/[^0-9.]+/).filter((t) => t && t !== '.');
  if (nums.length !== 2) return null;
  const w = parseFloat(nums[0]);
  const r = parseInt(nums[1], 10);
  return Number.isFinite(w) && Number.isFinite(r) ? [w, r] : null;
}

export const fmtW = (w: number) => (Number.isInteger(w) ? String(w) : String(w));
export const fmtSet = (s: LoggedSet) => `${fmtW(s.weight)} × ${s.reps}`;
export const when = (s: LoggedSet) => (s.date ? s.date : s.week != null ? `Week ${s.week}` : 'imported');
