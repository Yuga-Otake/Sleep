/** localStorage を薄くラップした永続層。保存できない環境でも動くようにフォールバックする。 */

const PREFIX = "nocturne:";
const memory = new Map();

function readRaw(key) {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return memory.has(key) ? memory.get(key) : null;
  }
}

function writeRaw(key, value) {
  memory.set(key, value);
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    /* プライベートモード等。メモリ上の値だけで動作を続ける。 */
  }
}

export function load(key, fallback) {
  const raw = readRaw(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  writeRaw(key, JSON.stringify(value));
}

/* ---------- 睡眠ログ ---------- */

export const LOG_KEY = "sleep-log";

/**
 * 1件のログ。時刻は "HH:MM"、分量は数値。
 * @typedef {{date:string, bedtime:string, latency:number, awake:number,
 *            wake:string, outOfBed:string, quality:number}} SleepEntry
 */

export function loadEntries() {
  const list = load(LOG_KEY, []);
  return Array.isArray(list) ? list.filter(isEntry).sort((a, b) => a.date.localeCompare(b.date)) : [];
}

function isEntry(e) {
  return e && typeof e.date === "string" && typeof e.bedtime === "string" && typeof e.wake === "string";
}

/** 同じ日付の記録は上書きする。 */
export function upsertEntry(entry) {
  const list = loadEntries().filter((e) => e.date !== entry.date);
  list.push(entry);
  list.sort((a, b) => a.date.localeCompare(b.date));
  save(LOG_KEY, list);
  return list;
}

export function removeEntry(date) {
  const list = loadEntries().filter((e) => e.date !== date);
  save(LOG_KEY, list);
  return list;
}
