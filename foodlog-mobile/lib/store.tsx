// App state: the log, saved on the phone and synced to your server.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { Db, emptyDb, Food, Meal, mealForHour, mergeDb, normalizeDb } from './model';
import { loadConfig, sync } from './server';

const KEY = 'foodlog.v1';

interface Store {
  db: Db;
  ready: boolean;
  update: (fn: (db: Db) => Db) => void;
  /** Meal new food goes into. */
  meal: Meal;
  setMeal: (m: Meal) => void;
  /** Food waiting for "how much?" (the Add screen opens the amount sheet). */
  picked: Food | null;
  setPicked: (f: Food | null) => void;
  /** The Add screen listens for scanned barcodes; the scanner reports them. */
  onScan: (handler: ((code: string) => void) | null) => void;
  reportScan: (code: string) => void;
  syncStatus: string;
  syncNow: () => void;
  toast: string;
  flash: (msg: string) => void;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Db>(emptyDb);
  const [ready, setReady] = useState(false);
  const [meal, setMeal] = useState<Meal>(mealForHour(new Date().getHours()));
  const [picked, setPicked] = useState<Food | null>(null);
  const scanHandler = useRef<((code: string) => void) | null>(null);
  const onScan = useCallback((h: ((code: string) => void) | null) => {
    scanHandler.current = h;
  }, []);
  const reportScan = useCallback((code: string) => scanHandler.current?.(code), []);
  const [syncStatus, setSyncStatus] = useState('');
  const [toast, setToast] = useState('');
  const dbRef = useRef(db);
  dbRef.current = db;
  const lastSynced = useRef<string>('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? '' : t)), 3000);
  }, []);

  const runSync = useCallback(async () => {
    if (!(await loadConfig())) {
      setSyncStatus('');
      return;
    }
    const sent = dbRef.current;
    setSyncStatus('Syncing…');
    try {
      const merged = normalizeDb(await sync(sent));
      lastSynced.current = JSON.stringify(merged);
      // Keep anything added while the request was out.
      setDb((now) => (now === sent ? merged : mergeDb(now, merged)));
      setSyncStatus('Synced');
    } catch (e) {
      setSyncStatus(`Not synced: ${(e as Error).message}`);
    }
  }, []);

  // Load once.
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((s) => s && setDb(normalizeDb(JSON.parse(s))))
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  // Save every change; sync a moment after edits stop.
  useEffect(() => {
    if (!ready) return;
    const json = JSON.stringify(db);
    AsyncStorage.setItem(KEY, json).catch(() => {});
    if (json === lastSynced.current) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(runSync, 1200);
  }, [db, ready, runSync]);

  // Pick up other devices' changes when the app comes back.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && runSync());
    return () => sub.remove();
  }, [runSync]);

  const update = useCallback((fn: (db: Db) => Db) => setDb((d) => fn(d)), []);

  return (
    <Ctx.Provider
      value={{ db, ready, update, meal, setMeal, picked, setPicked, onScan, reportScan, syncStatus, syncNow: runSync, toast, flash }}>
      {children}
    </Ctx.Provider>
  );
}
