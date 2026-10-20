// Open Food Facts (free, no key) — mirrors foodlog-core/src/off.rs.
import { TimeoutError, error as logError, info, loggedFetch } from './log';
import type { Food } from './model';

const BASE = 'https://world.openfoodfacts.org';
const FIELDS = 'code,product_name,product_name_en,brands,nutriments,serving_quantity';

const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};

export function parseProduct(p: any, fallbackCode: string): Food | null {
  const name = [p?.product_name_en, p?.product_name].find((s) => typeof s === 'string' && s.trim())?.trim();
  if (!name) return null;
  const n = p.nutriments ?? {};
  const servingG = num(p.serving_quantity);
  const serving = servingG && servingG > 0 ? servingG : null;
  const get = (key: string): number | null => {
    const per100 = num(n[`${key}_100g`]);
    if (per100 != null) return per100;
    const perServing = num(n[`${key}_serving`]);
    return perServing != null && serving ? (perServing * 100) / serving : null;
  };
  const kj = get('energy');
  const kcal = get('energy-kcal') ?? (kj != null ? kj / 4.184 : null);
  if (kcal == null) return null;
  return {
    id: (typeof p.code === 'string' && p.code) || fallbackCode,
    name,
    brand: String(Array.isArray(p.brands) ? p.brands[0] ?? '' : p.brands ?? '').split(',')[0].trim(),
    kcal,
    protein: get('proteins') ?? 0,
    carbs: get('carbohydrates') ?? 0,
    fat: get('fat') ?? 0,
    serving_g: serving,
    custom: false,
  };
}

// Open Food Facts asks apps to identify themselves; anonymous traffic gets throttled first.
const HEADERS = { 'User-Agent': 'FoodLog/1.0 (personal app; github.com/Childishprivito/git_test)' };

export class OffError extends Error {}

async function getJson(area: string, url: string, timeoutMs: number): Promise<any> {
  let resp: Response;
  try {
    resp = await loggedFetch(area, url, { headers: HEADERS, timeoutMs });
  } catch (e) {
    if (e instanceof TimeoutError) throw new OffError('Open Food Facts is slow right now. Try again in a moment.');
    throw new OffError("Couldn't reach Open Food Facts. Check your connection.");
  }
  if (resp.status === 429) throw new OffError('Too many searches in a row. Open Food Facts asks for a short wait; try again in a minute.');
  if (resp.status >= 500) throw new OffError('Open Food Facts is having trouble. Try again in a minute.');
  const body = await resp.text();
  try {
    return JSON.parse(body);
  } catch {
    // Usually an HTML "slow down" or maintenance page.
    logError(area, `Not JSON from Open Food Facts (status ${resp.status})`, body.slice(0, 300));
    throw new OffError('Open Food Facts sent back something unexpected. Try again in a minute.');
  }
}

export async function lookup(barcode: string): Promise<Food | null> {
  const codes = barcode.length === 12 ? [barcode, `0${barcode}`] : [barcode];
  for (const code of codes) {
    const json = await getJson('barcode', `${BASE}/api/v2/product/${code}.json?fields=${FIELDS}`, 12000);
    if (json?.status === 1) {
      const food = parseProduct(json.product, barcode);
      if (food) return food;
      info('barcode', `${code} found but has no usable nutrition data`);
    }
  }
  info('barcode', `${barcode} not in Open Food Facts`);
  return null;
}

// Recent searches, so repeating one doesn't spend Open Food Facts' search limit.
const cache = new Map<string, { at: number; foods: Food[] }>();

export async function search(query: string): Promise<Food[]> {
  const key = query.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60e3) {
    info('search', `"${query}": ${hit.foods.length} results (cached)`);
    return hit.foods;
  }
  const q = encodeURIComponent(query);
  const json = await getJson(
    'search',
    `${BASE}/cgi/search.pl?search_terms=${q}&search_simple=1&action=process&json=1&page_size=25&sort_by=unique_scans_n&fields=${FIELDS}`,
    20000,
  );
  const products: any[] = json?.products ?? [];
  const foods = products.map((p: any) => parseProduct(p, '')).filter(Boolean) as Food[];
  info('search', `"${query}": ${products.length} products, ${foods.length} with nutrition data`);
  cache.set(key, { at: Date.now(), foods });
  return foods;
}
