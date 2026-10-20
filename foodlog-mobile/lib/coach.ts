// Coach: one plain-text snapshot of everything the AI coach can see.
// Whatever AI account gets connected later reads this same snapshot.
import { Db, MEALS, dateString, dayTotals, foodTitle, macrosFor } from './model';
import { fmtSet, records, upNext } from './workout';

export interface Activity {
  steps: number;
  active: number;
}

const r = Math.round;

export function coachSnapshot(db: Db, activity: Activity | null, days = 7): string {
  const g = db.goals;
  const out: string[] = [];
  out.push(`Today is ${dateString(0)}.`);
  out.push(`Daily goals: ${r(g.kcal)} kcal, protein ${r(g.protein)} g, carbs ${r(g.carbs)} g, fat ${r(g.fat)} g.`);
  if (activity) out.push(`Apple Health today: ${r(activity.steps)} steps, ${r(activity.active)} active kcal.`);

  out.push('', `## Meals (last ${days} days)`);
  for (let i = 0; i > -days; i--) {
    const date = dateString(i);
    const entries = db.entries.filter((e) => e.date === date);
    if (!entries.length) {
      out.push(`${date}: nothing logged`);
      continue;
    }
    const t = dayTotals(db, date);
    out.push(`${date}: ${r(t.kcal)} kcal, P ${r(t.protein)} / C ${r(t.carbs)} / F ${r(t.fat)}`);
    for (const meal of MEALS) {
      const items = entries.filter((e) => e.meal === meal);
      if (items.length)
        out.push(`  ${meal}: ${items.map((e) => `${foodTitle(e.food)} ${r(e.grams)} g (${r(macrosFor(e.food, e.grams).kcal)} kcal)`).join('; ')}`);
    }
  }

  out.push('', '## Training');
  const p = db.program;
  if (p) {
    const next = upNext(p, db.sets);
    const day = next && p.weeks.find((w) => w.number === next.week)?.days[next.day];
    out.push(`Program: ${p.name} (${p.weeks.length} weeks).`);
    if (day)
      out.push(`Up next: week ${next!.week}, ${day.name}: ${day.exercises.map((x) => `${x.name} ${x.working_sets}×${x.reps}`).join('; ')}`);
  } else out.push('No program imported.');

  const recent = db.sets.filter((s) => s.date && s.date >= dateString(-days * 2)).sort((a, b) => a.date.localeCompare(b.date));
  if (recent.length) {
    out.push('Recent sets (lb × reps):');
    const byDay = new Map<string, string[]>();
    for (const s of recent) {
      const k = `${s.date}${s.day ? ` ${s.day}` : ''}`;
      byDay.set(k, [...(byDay.get(k) ?? []), `${s.exercise} ${fmtSet(s)}`]);
    }
    for (const [k, v] of byDay) out.push(`  ${k}: ${v.join('; ')}`);
  }
  const prs = records(db.sets);
  if (prs.length) {
    out.push('Personal records (heaviest set):');
    for (const pr of prs) out.push(`  ${pr.exercise}: ${fmtSet(pr.heaviest)}`);
  }
  return out.join('\n');
}
