// Open Food Facts (free, no key) — mirrors foodlog-core/src/off.rs.
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
    brand: String(p.brands ?? '').split(',')[0].trim(),
    kcal,
    protein: get('proteins') ?? 0,
    carbs: get('carbohydrates') ?? 0,
    fat: get('fat') ?? 0,
    serving_g: serving,
    custom: false,
  };
}

async function getJson(url: string): Promise<any> {
  let resp: Response;
  try {
    resp = await fetch(url);
  } catch {
    throw new Error("Couldn't reach Open Food Facts. Check your connection.");
  }
  if (resp.status >= 500) throw new Error('Open Food Facts is having trouble. Try again in a minute.');
  return resp.json();
}

export async function lookup(barcode: string): Promise<Food | null> {
  const codes = barcode.length === 12 ? [barcode, `0${barcode}`] : [barcode];
  for (const code of codes) {
    const json = await getJson(`${BASE}/api/v2/product/${code}.json?fields=${FIELDS}`);
    if (json?.status === 1) {
      const food = parseProduct(json.product, barcode);
      if (food) return food;
    }
  }
  return null;
}

export async function search(query: string): Promise<Food[]> {
  const q = encodeURIComponent(query);
  const json = await getJson(
    `${BASE}/cgi/search.pl?search_terms=${q}&search_simple=1&action=process&json=1&page_size=25&sort_by=unique_scans_n&fields=${FIELDS}`,
  );
  return (json?.products ?? []).map((p: any) => parseProduct(p, '')).filter(Boolean) as Food[];
}
