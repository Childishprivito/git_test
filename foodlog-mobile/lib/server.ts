// Your FoodLog server (foodlog-worker/): sync, USDA search, AI photo search.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TimeoutError, error as logError, loggedFetch } from './log';
import type { Db, Food } from './model';

const KEY = 'foodlog.server';

export interface ServerConfig {
  url: string;
  password: string;
}

export interface Estimate {
  name: string;
  brand: string;
  search_query: string;
  serving_description: string;
  serving_g: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  confidence: string;
  notes: string;
}

export async function loadConfig(): Promise<ServerConfig | null> {
  try {
    const c = JSON.parse((await AsyncStorage.getItem(KEY)) ?? 'null') as ServerConfig | null;
    return c && c.url && c.password ? c : null;
  } catch {
    return null;
  }
}

export async function saveConfig(c: ServerConfig) {
  await AsyncStorage.setItem(KEY, JSON.stringify(c));
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const c = await loadConfig();
  if (!c) throw new Error('Set up your server in Settings first.');
  let resp: Response;
  try {
    resp = await loggedFetch(`server${path.split('?')[0]}`, `${c.url.trim().replace(/\/+$/, '')}${path}`, {
      ...init,
      timeoutMs: path.startsWith('/estimate') ? 60000 : 20000,
      headers: { Authorization: `Bearer ${c.password}`, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    if (e instanceof TimeoutError) throw new Error('Your FoodLog server took too long to answer.');
    throw new Error("Can't reach your FoodLog server. Are you online?");
  }
  const body = await resp.json().catch(() => null);
  if (!resp.ok) {
    logError(`server${path.split('?')[0]}`, `Server error ${resp.status}`, body);
    throw new Error(body?.error ?? `Server error (${resp.status}).`);
  }
  return body as T;
}

/** Send this device's log; get back the merged log from all devices. */
export const sync = (db: Db) => call<Db>('/sync', { method: 'POST', body: JSON.stringify(db) });

export const usda = (q: string, upc = false) =>
  call<Food[]>(`/usda?${upc ? 'upc' : 'q'}=${encodeURIComponent(q)}`);

export const estimate = (imageBase64: string, text = '') =>
  call<Estimate>('/estimate', {
    method: 'POST',
    body: JSON.stringify({ text, image: { media_type: 'image/jpeg', data: imageBase64 } }),
  });

export function estimateToFood(e: Estimate, id: string): Food {
  const g = e.serving_g > 0 ? e.serving_g : 100;
  const per100 = (v: number) => (Math.max(0, v) * 100) / g;
  return {
    id,
    name: e.name,
    brand: e.brand,
    kcal: per100(e.kcal),
    protein: per100(e.protein_g),
    carbs: per100(e.carbs_g),
    fat: per100(e.fat_g),
    serving_g: g,
    custom: true,
  };
}
