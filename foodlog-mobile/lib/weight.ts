// Weight log helpers shared by the Profile chart and Coach.

export interface Point {
  date: string; // YYYY-MM-DD
  lb: number;
  avg: number; // trailing 7-day average
}

const dayMs = (d: string) => new Date(`${d}T12:00:00`).getTime();

/** Daily points (last reading of each day) with a trailing 7-day average. */
export function toPoints(weights: { date: string; lb: number; id: number }[], sinceDate: string | null): Point[] {
  const byDay = new Map<string, { lb: number; id: number }>();
  for (const w of weights) {
    const cur = byDay.get(w.date);
    if (!cur || w.id > cur.id) byDay.set(w.date, { lb: w.lb, id: w.id });
  }
  const days = [...byDay.keys()].sort();
  const all = days.map((d) => {
    const from = dayMs(d) - 6 * 864e5;
    const win = days.filter((x) => dayMs(x) >= from && x <= d).map((x) => byDay.get(x)!.lb);
    return { date: d, lb: byDay.get(d)!.lb, avg: win.reduce((a, b) => a + b, 0) / win.length };
  });
  return sinceDate ? all.filter((p) => p.date >= sinceDate) : all;
}
