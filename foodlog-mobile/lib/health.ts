// Apple Health. Works in a development/TestFlight build of this app;
// in Expo Go (and on web/Android) the native module isn't there, so
// everything here quietly reports "not available".
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform, TurboModuleRegistry } from 'react-native';
import type { Entry, LoggedSet } from './model';
import { macrosFor } from './model';

type HK = typeof import('@kingstinct/react-native-healthkit');

let hk: HK | null | undefined;
function load(): HK | null {
  if (hk !== undefined) return hk;
  hk = null;
  if (Platform.OS !== 'ios') return hk;
  // Expo Go doesn't include the native module. Check before requiring it:
  // React Native reports an error thrown while a module loads as a crash,
  // so a try/catch around require() isn't enough.
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return hk;
  if (TurboModuleRegistry.get('NitroModules') == null) return hk;
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
    toShare: [...NUTRITION, 'HKWorkoutTypeIdentifier', 'HKQuantityTypeIdentifierBodyMass'],
    toRead: [
      'HKQuantityTypeIdentifierStepCount',
      'HKQuantityTypeIdentifierActiveEnergyBurned',
      'HKQuantityTypeIdentifierAppleExerciseTime',
      'HKQuantityTypeIdentifierBodyMass',
      'HKQuantityTypeIdentifierBodyFatPercentage',
      'HKQuantityTypeIdentifierHeight',
      'HKQuantityTypeIdentifierRestingHeartRate',
      'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
      'HKQuantityTypeIdentifierVO2Max',
      'HKCategoryTypeIdentifierSleepAnalysis',
      'HKWorkoutTypeIdentifier',
    ],
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

export interface HealthOverview {
  weight?: { lb: number; date: Date };
  bodyFatPct?: number;
  heightIn?: number;
  restingHr?: number;
  hrvMs?: number;
  vo2max?: number;
  stepsPerDay7: number;
  activeKcalPerDay7: number;
  exerciseMinToday: number;
  sleepHoursLastNight?: number;
  workouts7: number;
  workoutMinutes7: number;
}

async function safe<T>(p: Promise<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch {
    return undefined;
  }
}

/** Everything the Profile page shows from Apple Health. Missing data is left out. */
export async function healthOverview(): Promise<HealthOverview | null> {
  const h = load();
  if (!h) return null;
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 864e5);
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const week = { filter: { date: { startDate: weekAgo, endDate: now } } };
  const today = { filter: { date: { startDate: midnight, endDate: now } } };
  // Sleep: from 6 pm yesterday to now.
  const evening = new Date(midnight.getTime() - 6 * 36e5);

  const [weight, fat, height, rhr, hrv, vo2, steps, active, exercise, sleep, workouts] = await Promise.all([
    safe(h.getMostRecentQuantitySample('HKQuantityTypeIdentifierBodyMass', 'lb')),
    safe(h.getMostRecentQuantitySample('HKQuantityTypeIdentifierBodyFatPercentage', '%')),
    safe(h.getMostRecentQuantitySample('HKQuantityTypeIdentifierHeight', 'in')),
    safe(h.getMostRecentQuantitySample('HKQuantityTypeIdentifierRestingHeartRate', 'count/min')),
    safe(h.getMostRecentQuantitySample('HKQuantityTypeIdentifierHeartRateVariabilitySDNN', 'ms')),
    safe(h.getMostRecentQuantitySample('HKQuantityTypeIdentifierVO2Max', 'ml/(kg*min)')),
    safe(h.queryStatisticsForQuantity('HKQuantityTypeIdentifierStepCount', ['cumulativeSum'], { ...week, unit: 'count' })),
    safe(h.queryStatisticsForQuantity('HKQuantityTypeIdentifierActiveEnergyBurned', ['cumulativeSum'], { ...week, unit: 'kcal' })),
    safe(h.queryStatisticsForQuantity('HKQuantityTypeIdentifierAppleExerciseTime', ['cumulativeSum'], { ...today, unit: 'min' })),
    safe(h.queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis', { limit: -1, filter: { date: { startDate: evening, endDate: now } } })),
    safe(h.queryWorkoutSamples({ limit: -1, filter: { date: { startDate: weekAgo, endDate: now } } })),
  ]);

  // Asleep = any "asleep" stage (not in bed / awake).
  const asleep = [h.CategoryValueSleepAnalysis.asleepUnspecified, h.CategoryValueSleepAnalysis.asleepCore, h.CategoryValueSleepAnalysis.asleepDeep, h.CategoryValueSleepAnalysis.asleepREM] as number[];
  const sleepMs = (sleep ?? [])
    .filter((x) => asleep.includes(x.value as number))
    .reduce((a, x) => a + (new Date(x.endDate).getTime() - new Date(x.startDate).getTime()), 0);

  return {
    weight: weight ? { lb: weight.quantity, date: new Date(weight.endDate) } : undefined,
    // Health stores body fat as a fraction (0.18) or percent depending on unit; normalise to percent.
    bodyFatPct: fat ? (fat.quantity <= 1 ? fat.quantity * 100 : fat.quantity) : undefined,
    heightIn: height?.quantity,
    restingHr: rhr?.quantity,
    hrvMs: hrv?.quantity,
    vo2max: vo2?.quantity,
    stepsPerDay7: (steps?.sumQuantity?.quantity ?? 0) / 7,
    activeKcalPerDay7: (active?.sumQuantity?.quantity ?? 0) / 7,
    exerciseMinToday: exercise?.sumQuantity?.quantity ?? 0,
    sleepHoursLastNight: sleepMs > 0 ? sleepMs / 36e5 : undefined,
    workouts7: workouts?.length ?? 0,
    workoutMinutes7: (workouts ?? []).reduce((a, w) => a + (new Date(w.endDate).getTime() - new Date(w.startDate).getTime()) / 6e4, 0),
  };
}

/** Body weight readings from Health (any app or smart scale), newest last. */
export async function healthWeights(days: number): Promise<{ date: Date; lb: number }[]> {
  const h = load();
  if (!h) return [];
  const startDate = new Date(Date.now() - days * 864e5);
  const rows = await safe(
    h.queryQuantitySamples('HKQuantityTypeIdentifierBodyMass', { limit: -1, ascending: true, unit: 'lb', filter: { date: { startDate, endDate: new Date() } } }),
  );
  return (rows ?? []).map((r) => ({ date: new Date(r.endDate), lb: r.quantity }));
}

export async function saveWeightToHealth(lb: number, at: Date): Promise<void> {
  const h = load();
  if (!h) return;
  await h.saveQuantitySample('HKQuantityTypeIdentifierBodyMass', 'lb', lb, at, at, { FoodLog: 'weigh-in' });
}

// Whether you've turned on "Send to Apple Health" in Settings (this phone only).
import AsyncStorage from '@react-native-async-storage/async-storage';
const FLAG = 'foodlog.health';
export const healthEnabled = async () => healthAvailable() && (await AsyncStorage.getItem(FLAG)) === '1';
export const setHealthEnabled = (on: boolean) => AsyncStorage.setItem(FLAG, on ? '1' : '0');
