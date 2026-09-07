/**
 * 睡眠ログから指標と就床時刻の提案を計算する純関数群。
 * DOM に触れないので、そのまま Node からテストできる。
 */

import { toMinutes, toHHMM, spanMinutes, clamp } from "./util.js";

/** 提案に使う直近の日数 */
export const WINDOW_DAYS = 7;
/** 提案に必要な最低記録数 */
export const MIN_ENTRIES = 3;
/** 床上時間の下限・上限 (分) */
export const MIN_WINDOW = 300;
export const MAX_WINDOW = 540;
/** 目標とする睡眠効率の帯 (%) */
export const EFF_LOW = 85;
export const EFF_HIGH = 90;

/**
 * 1件のログを指標に変換する。時刻が不正な場合は null。
 * - 床上時間 (TIB): 就床から離床まで
 * - 総睡眠時間 (TST): 就床から起床までから、入眠潜時と夜間覚醒を引いたもの
 * - 睡眠効率: TST / TIB
 */
export function metricsFor(entry) {
  const bed = toMinutes(entry.bedtime);
  const wake = toMinutes(entry.wake);
  const outOfBed = toMinutes(entry.outOfBed || entry.wake);
  if (bed == null || wake == null || outOfBed == null) return null;

  const timeInBed = spanMinutes(bed, outOfBed);
  const latency = Math.max(0, Number(entry.latency) || 0);
  const awake = Math.max(0, Number(entry.awake) || 0);
  const totalSleep = clamp(spanMinutes(bed, wake) - latency - awake, 0, timeInBed);
  if (timeInBed <= 0) return null;

  return {
    date: entry.date,
    timeInBed,
    totalSleep,
    latency,
    awake,
    quality: Number(entry.quality) || null,
    efficiency: clamp((totalSleep / timeInBed) * 100, 0, 100),
  };
}

/** 新しい順に最大 days 件を取り、古い順に並べて返す。 */
export function recentMetrics(entries, days = WINDOW_DAYS) {
  return entries
    .map(metricsFor)
    .filter(Boolean)
    .slice(-days);
}

export function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * 睡眠制限法の考え方にもとづく床上時間の提案。
 *
 * 直近の平均睡眠時間に 30 分を足したものを基準の枠とし、平均睡眠効率が
 * 高ければ 15 分広げ、低ければ 15 分狭める。枠は 5〜9 時間に収める。
 * 起床時刻は固定し、就床時刻のほうを動かす。
 *
 * @param {object[]} entries 全ログ
 * @param {string} riseTime  固定したい起床時刻 "HH:MM"
 */
export function suggestWindow(entries, riseTime) {
  const metrics = recentMetrics(entries);
  if (metrics.length < MIN_ENTRIES) {
    return { ready: false, needed: MIN_ENTRIES - metrics.length, samples: metrics.length };
  }

  const avgEfficiency = average(metrics.map((m) => m.efficiency));
  const avgSleep = average(metrics.map((m) => m.totalSleep));

  let adjustment = 0;
  let verdict;
  if (avgEfficiency >= EFF_HIGH) {
    adjustment = 15;
    verdict = "extend";
  } else if (avgEfficiency < EFF_LOW) {
    adjustment = -15;
    verdict = "compress";
  } else {
    verdict = "hold";
  }

  const rawWindow = avgSleep + 30 + adjustment;
  const windowMinutes = clamp(Math.round(rawWindow / 5) * 5, MIN_WINDOW, MAX_WINDOW);

  const rise = toMinutes(riseTime);
  const bedtime = rise == null ? null : toHHMM(rise - windowMinutes);

  return {
    ready: true,
    samples: metrics.length,
    avgEfficiency,
    avgSleep,
    windowMinutes,
    bedtime,
    riseTime,
    verdict,
    clamped: Math.round(rawWindow) !== windowMinutes,
  };
}

/** 記録済みの起床時刻の平均を 5 分刻みで返す。記録がなければ null。 */
export function averageRiseTime(entries) {
  const times = entries.map((e) => toMinutes(e.wake)).filter((v) => v != null);
  if (!times.length) return null;
  return toHHMM(Math.round(average(times) / 5) * 5);
}
