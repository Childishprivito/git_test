// App log: what happened, when, and what went wrong. Kept on the phone
// (last 500 lines) and viewable/shareable from Settings › Logs.
// Captures crashes, unhandled promise errors, console errors/warnings and
// every network request made through loggedFetch().
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

export type Level = 'info' | 'warn' | 'error';

export interface LogLine {
  t: number; // ms since 1970
  level: Level;
  area: string; // e.g. "search", "sync", "coach", "crash"
  msg: string;
  data?: string;
}

const KEY = 'foodlog.log';
const MAX = 500;
let lines: LogLine[] = [];
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    AsyncStorage.setItem(KEY, JSON.stringify(lines)).catch(() => {});
  }, 500);
}

function text(v: unknown): string {
  if (v instanceof Error) return `${v.name}: ${v.message}${v.stack ? `\n${v.stack.split('\n').slice(0, 6).join('\n')}` : ''}`;
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function log(level: Level, area: string, msg: string, data?: unknown) {
  const line: LogLine = { t: Date.now(), level, area, msg: msg.slice(0, 500) };
  if (data !== undefined) line.data = text(data).slice(0, 2000);
  lines.push(line);
  if (lines.length > MAX) lines = lines.slice(-MAX);
  persist();
  listeners.forEach((f) => f());
}

export const info = (area: string, msg: string, data?: unknown) => log('info', area, msg, data);
export const warn = (area: string, msg: string, data?: unknown) => log('warn', area, msg, data);
export const error = (area: string, msg: string, data?: unknown) => log('error', area, msg, data);

export async function loadLog() {
  if (loaded) return;
  loaded = true;
  try {
    const saved = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]') as LogLine[];
    lines = [...saved, ...lines].slice(-MAX);
  } catch {
    // corrupt log: start fresh
  }
  listeners.forEach((f) => f());
}

export const getLog = () => lines;
export function clearLog() {
  lines = [];
  AsyncStorage.removeItem(KEY).catch(() => {});
  listeners.forEach((f) => f());
}
export function onLog(f: () => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

export function formatLog(ls: LogLine[]): string {
  return ls
    .map((l) => {
      const d = new Date(l.t);
      const ts = `${d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' })} ${d.toTimeString().slice(0, 8)}`;
      return `${ts} ${l.level.toUpperCase().padEnd(5)} [${l.area}] ${l.msg}${l.data ? `\n    ${l.data.replace(/\n/g, '\n    ')}` : ''}`;
    })
    .join('\n');
}

/** Hide secrets in URLs before they're logged. */
function safeUrl(url: string): string {
  return url
    .replace(/([?&](api_key|key|token|password)=)[^&]*/gi, '$1…')
    .replace(/&(fields|search_simple|action|json|sort_by)=[^&]*/g, ''); // noise
}

/**
 * fetch() that logs the outcome: method, URL, status, time taken.
 * Pass timeoutMs to give up on a slow server (default 15 s).
 */
export async function loggedFetch(area: string, url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = 15000, ...rest } = init;
  const method = rest.method ?? 'GET';
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  if (rest.signal) rest.signal.addEventListener('abort', () => ctrl.abort());
  try {
    const res = await fetch(url, { ...rest, signal: ctrl.signal });
    const ms = Date.now() - started;
    log(res.ok ? 'info' : 'warn', area, `${method} ${safeUrl(url)} → ${res.status} in ${ms} ms`);
    return res;
  } catch (e) {
    const ms = Date.now() - started;
    const timedOut = ctrl.signal.aborted && !rest.signal?.aborted;
    log('error', area, `${method} ${safeUrl(url)} ${timedOut ? `timed out after ${ms} ms` : `failed after ${ms} ms`}`, e);
    if (timedOut) throw new TimeoutError();
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export class TimeoutError extends Error {
  constructor() {
    super('The request took too long.');
    this.name = 'TimeoutError';
  }
}

/** Catch crashes, unhandled promise errors and console errors app-wide. Call once at startup. */
export function installGlobalLogging() {
  const g = globalThis as unknown as {
    ErrorUtils?: { getGlobalHandler: () => (e: unknown, fatal?: boolean) => void; setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void };
    HermesInternal?: { enablePromiseRejectionTracker?: (o: { allRejections: boolean; onUnhandled: (id: number, e: unknown) => void }) => void };
    __foodlogLogging?: boolean;
  };
  if (g.__foodlogLogging) return;
  g.__foodlogLogging = true;

  // Save straight away when the app is put in the background.
  AppState.addEventListener('change', (state) => {
    if (state !== 'active') AsyncStorage.setItem(KEY, JSON.stringify(lines)).catch(() => {});
  });

  const prev = g.ErrorUtils?.getGlobalHandler();
  g.ErrorUtils?.setGlobalHandler((e, fatal) => {
    log('error', 'crash', fatal ? 'App crashed' : 'Uncaught error', e);
    // Save right away: the app may be about to close.
    AsyncStorage.setItem(KEY, JSON.stringify(lines)).catch(() => {});
    prev?.(e, fatal);
  });

  g.HermesInternal?.enablePromiseRejectionTracker?.({
    allRejections: true,
    onUnhandled: (_id, e) => log('error', 'promise', 'Unhandled promise error', e),
  });

  for (const level of ['error', 'warn'] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      log(level, 'console', args.map(text).join(' ').slice(0, 500));
      orig(...args);
    };
  }
}
