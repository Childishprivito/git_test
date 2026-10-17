// Apple Health. Works in a development/TestFlight build of this app;
// in Expo Go (and on web/Android) the native module isn't there, so
// everything here quietly reports "not available".
import { Platform } from 'react-native';
import type { Entry, LoggedSet } from './model';
import { macrosFor } from './model';

type HK = typeof import('@kingstinct/react-native-healthkit');

let hk: HK | null | undefined;
function load(): HK | null {
  if (hk !== undefined) return hk;
  hk = null;
  if (Platform.OS !== 'ios') return hk;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod: HK = require('@kingstinct/react-native-healthkit');
    if (mod.isHealthDataAvailable()) hk = mod;
  } catch {
    hk = null; // Expo Go: native module missing
  }
  return hk;
}

export const healthAvailable = () => load() != null;

const NUTRITION = [
  'HKQuantityTypeIdentifierDietaryEnergyConsumed',
  'HKQuantityTypeIdentifierDietaryProtein',
  'HKQuantityTypeIdentifierDietaryCarbohydrates',
  'HKQuantityTypeIdentifierDietaryFatTotal',
] as const;

export async function connectHealth(): Promise<boolean> {
  const h = load();
  if (!h) return false;
  return h.requestAuthorization({
    toShare: [...NUTRITION, 'HKWorkoutTypeIdentifier'],
    toRead: ['HKQuantityTypeIdentifierStepCount', 'HKQuantityTypeIdentifierActiveEnergyBurned', 'HKQuantityTypeIdentifierBodyMass'],
  });
}

/** Write one diary entry's calories and macros to Health. */
export async function saveFoodToHealth(e: Entry): Promise<void> {
  const h = load();
  if (!h) return;
  const m = macrosFor(e.food, e.grams);
  const at = new Date();
  const meta = { HKFoodType: e.food.name, FoodLogEntryId: String(e.id) };
  await h.saveQuantitySample('HKQuantityTypeIdentifierDietaryEnergyConsumed', 'kcal', m.kcal, at, at, meta);
  await h.saveQuantitySample('HKQuantityTypeIdentifierDietaryProtein', 'g', m.protein, at, at, meta);
  await h.saveQuantitySample('HKQuantityTypeIdentifierDietaryCarbohydrates', 'g', m.carbs, at, at, meta);
  await h.saveQuantitySample('HKQuantityTypeIdentifierDietaryFatTotal', 'g', m.fat, at, at, meta);
}

/** Save a finished workout as strength training. */
export async function saveWorkoutToHealth(sets: LoggedSet[], start: Date, end: Date, name: string): Promise<void> {
  const h = load();
  if (!h || sets.length === 0) return;
  await h.saveWorkoutSample(h.WorkoutActivityType.traditionalStrengthTraining, [], start, end, undefined, {
    HKWorkoutBrandName: 'FoodLog',
    FoodLogDay: name,
    FoodLogSets: sets.length,
  });
}

/** Today's steps and active calories, for the diary. */
export async function todayActivity(): Promise<{ steps: number; active: number } | null> {
  const h = load();
  if (!h) return null;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const filter = { date: { startDate: start, endDate: new Date() } };
  const [steps, active] = await Promise.all([
    h.queryStatisticsForQuantity('HKQuantityTypeIdentifierStepCount', ['cumulativeSum'], { filter, unit: 'count' }),
    h.queryStatisticsForQuantity('HKQuantityTypeIdentifierActiveEnergyBurned', ['cumulativeSum'], { filter, unit: 'kcal' }),
  ]);
  return { steps: steps.sumQuantity?.quantity ?? 0, active: active.sumQuantity?.quantity ?? 0 };
}

// Whether you've turned on "Send to Apple Health" in Settings (this phone only).
import AsyncStorage from '@react-native-async-storage/async-storage';
const FLAG = 'foodlog.health';
export const healthEnabled = async () => healthAvailable() && (await AsyncStorage.getItem(FLAG)) === '1';
export const setHealthEnabled = (on: boolean) => AsyncStorage.setItem(FLAG, on ? '1' : '0');
