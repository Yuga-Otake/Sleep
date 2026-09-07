import assert from "node:assert/strict";
import { metricsFor, suggestWindow, averageRiseTime } from "../js/sleep-math.js";

// 23:00 就床 → 07:00 起床 → 07:15 離床、入眠20分・中途覚醒10分
const m = metricsFor({ date: "2026-09-01", bedtime: "23:00", wake: "07:00", outOfBed: "07:15", latency: 20, awake: 10 });
assert.equal(m.timeInBed, 495);
assert.equal(m.totalSleep, 480 - 30);
assert.ok(Math.abs(m.efficiency - (450 / 495) * 100) < 1e-9);

// 離床時刻の未入力は起床時刻で代用される
assert.equal(metricsFor({ date: "d", bedtime: "23:00", wake: "07:00", latency: 0, awake: 0 }).timeInBed, 480);
// 不正な時刻は null
assert.equal(metricsFor({ date: "d", bedtime: "25:99", wake: "07:00" }), null);
// 睡眠時間は床上時間を超えない
assert.ok(metricsFor({ date: "d", bedtime: "23:00", wake: "07:00", outOfBed: "23:30", latency: 0, awake: 0 }).efficiency <= 100);

const mk = (date, bedtime, wake, latency, awake) => ({ date, bedtime, wake, outOfBed: wake, latency, awake, quality: 3 });

// 効率が高い週 → 枠を広げる
const good = ["2026-09-01","2026-09-02","2026-09-03","2026-09-04"].map((d) => mk(d, "23:30", "06:30", 5, 5));
const s1 = suggestWindow(good, "06:30");
assert.equal(s1.ready, true);
assert.equal(s1.verdict, "extend");
assert.ok(s1.avgEfficiency > 95);

// 効率が低い週 → 枠を狭める
const bad = ["2026-09-01","2026-09-02","2026-09-03","2026-09-04"].map((d) => mk(d, "22:00", "07:00", 90, 60));
const s2 = suggestWindow(bad, "07:00");
assert.equal(s2.verdict, "compress");
assert.ok(s2.windowMinutes >= 300);
assert.equal(typeof s2.bedtime, "string");

// 記録不足
assert.equal(suggestWindow([mk("2026-09-01", "23:00", "07:00", 10, 0)], "07:00").ready, false);

// 平均起床時刻
assert.equal(averageRiseTime([mk("a","23:00","06:30",0,0), mk("b","23:00","07:00",0,0)]), "06:45");

console.log("sleep-math: すべてのテストが通りました");
