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

// Everyday words that USDA names differently.
const SYNONYMS: Record<string, string> = {
  oatmeal: 'oats',
  oatmeals: 'oats',
  hamburger: 'beef ground',
  steak: 'beef steak',
  'peanut butter': 'peanut butter',
  oj: 'orange juice',
  pb: 'peanut butter',
  fries: 'french fried potatoes',
  chickpea: 'chickpeas garbanzo',
  garbanzo: 'chickpeas garbanzo',
  shrimp: 'crustaceans shrimp',
  crab: 'crustaceans crab',
  tuna: 'fish tuna',
  cod: 'fish cod',
  tilapia: 'fish tilapia',
};

// Plain, everyday forms rank up; processed or unusual forms rank down
// (unless the search asks for them).
const PLAIN = new Set(['raw', 'whole', 'cooked', 'roasted', 'boiled', 'baked', 'grilled', 'fresh', 'plain', 'regular', 'broiler', 'fryer', 'lean']);
const UNUSUAL = new Set([
  'roll', 'sliced', 'deli', 'mix', 'dry', 'dried', 'flavor', 'flavored', 'mesquite', 'babyfood', 'imitation', 'substitute',
  'sheep', 'goat', 'human', 'buffalo', 'yolk', 'canned', 'frozen', 'dehydrated', 'powder', 'concentrate', 'prepared',
  'industrial', 'commercial', 'school', 'lunch', 'fat-free', 'free', 'low', 'sodium', 'reduced', 'imported', 'alaska', 'native',
  'overripe', 'leaves', 'variety', 'organ', 'giblet', 'liver', 'heart', 'cereal', 'loaf', 'nugget', 'tender', 'breaded',
  'microwaved', 'heated', 'unheated', 'purchased', 'buttermilk', 'stick', 'battered', 'fast', 'food', 'restaurant', 'snack',
  'fruit', 'glutinous',
]);
// USDA files some foods under a category ("Nuts, almonds", "Fish, salmon, ...").
// For those, the food's own name is the second part.
const CATEGORY = new Set(['nut', 'fish', 'cheese', 'spice', 'cereal', 'crustacean', 'mollusk', 'seed', 'beverage', 'game', 'lamb', 'pork', 'veal', 'beef', 'turkey', 'chicken', 'bean', 'pea', 'lentil', 'squash', 'cabbage', 'lettuce', 'pepper', 'onion', 'tomato']);

function head(name: string): string[] {
  const parts = name.split(',');
  const first = tokenize(parts[0]);
  return first.length === 1 && CATEGORY.has(first[0]) && parts[1] ? [...first, ...tokenize(parts[1])] : first;
}

function load(): Indexed[] {
  if (index) return index;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const data = require('../assets/foods/usda.json') as { foods: Row[] };
  index = data.foods.map((row) => {
    const name = row[1];
    return { row, tokens: tokenize(name), head: head(name) };
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
  const q = norm(query);
  const words = tokenize(SYNONYMS[q] ?? q.split(' ').map((w) => SYNONYMS[w] ?? w).join(' '));
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
      if (item.head.some((t) => t === w || t.startsWith(w))) score += 6;
    }
    if (!ok) continue;
    // Extra words in the main name mean a more specific product ("Chicken breast tenders").
    score -= item.head.filter((t) => !CATEGORY.has(t) && !words.some((w) => t.startsWith(w))).length * 4;
    // Prefer simple names and everyday forms.
    score -= item.tokens.length * 0.3;
    let plain = false;
    for (const t of item.tokens) {
      if (words.includes(t)) continue;
      if (PLAIN.has(t)) plain = true;
      else if (UNUSUAL.has(t)) score -= 5;
    }
    if (plain) score += 2;
    if (item.tokens.includes('whole') && !words.includes('whole')) score += 1;
    scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score || a.item.row[1].length - b.item.row[1].length);
  // Some foods appear more than once (different samples); show each name once.
  const seen = new Set<string>();
  const out: Food[] = [];
  for (const s of scored) {
    const key = s.item.row[1].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(toFood(s.item.row));
    if (out.length >= limit) break;
  }
  return out;
}
