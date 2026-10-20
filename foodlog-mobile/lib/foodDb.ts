// Built-in food database: USDA FoodData Central "Foundation" and "SR Legacy"
// foods (plain foods: meat, produce, grains, dairy...), shipped inside the app.
// Public domain. Searching it is instant, offline and has no limits.
// The data file is made by scripts/build-food-db.py.
import type { Food } from './model';

/** Compact row: [fdcId, name, kcal, protein, carbs, fat, servingG, servingLabel] (per 100 g). */
type Row = [number, string, number, number, number, number, number | null, string | null];

interface Indexed {
  row: Row;
  tokens: string[];
  head: string[]; // tokens before the first comma, e.g. "chicken" in "Chicken, breast, ..."
}

let index: Indexed[] | null = null;

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();

/** Rough singular, so "eggs" finds "egg" and "berries" finds "berry". */
function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(ches|shes|oes|xes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

const tokenize = (s: string) => norm(s).split(' ').filter(Boolean).map(stem);

function load(): Indexed[] {
  if (index) return index;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const data = require('../assets/foods/usda.json') as { foods: Row[] };
  index = data.foods.map((row) => {
    const name = row[1];
    return { row, tokens: tokenize(name), head: tokenize(name.split(',')[0]) };
  });
  return index;
}

export const builtInCount = () => load().length;

export function toFood(row: Row): Food {
  return {
    id: `usda-${row[0]}`,
    name: row[1],
    brand: '',
    kcal: row[2],
    protein: row[3],
    carbs: row[4],
    fat: row[5],
    serving_g: row[6],
    serving_label: row[7] ?? undefined,
    custom: false,
  };
}

/**
 * Search the built-in foods. Every word must match the start of a word in the
 * name. Foods whose main name (before the first comma) matches rank first;
 * shorter, simpler names beat long specific ones.
 */
export function searchBuiltIn(query: string, limit = 25): Food[] {
  const words = tokenize(query);
  if (!words.length) return [];
  const scored: { item: Indexed; score: number }[] = [];
  for (const item of load()) {
    let score = 0;
    let ok = true;
    for (const w of words) {
      const exact = item.tokens.includes(w);
      if (!exact && !item.tokens.some((t) => t.startsWith(w))) {
        ok = false;
        break;
      }
      score += exact ? 10 : 6;
      if (item.head.includes(w)) score += 12;
      else if (item.head.some((t) => t.startsWith(w))) score += 6;
    }
    if (!ok) continue;
    // Prefer simple names and everyday forms.
    score -= item.tokens.length * 0.8;
    if (item.tokens.includes('raw')) score += 2;
    if (item.head.length === words.length && words.every((w) => item.head.includes(w))) score += 8;
    scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score || a.item.row[1].length - b.item.row[1].length);
  return scored.slice(0, limit).map((s) => toFood(s.item.row));
}
