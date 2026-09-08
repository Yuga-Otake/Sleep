/**
 * 呼吸ガイドのセッション。
 *
 * 表示（js/views/breathe.js）から切り離して、時間の管理とパターンをここに置く。
 * 画面を離れてもセッションは走り続け、合図音も鳴り続ける。表示中のビューだけが
 * bind() で描画関数を差し込み、離れるときに unbind() する。
 */

import { createWakeLock } from "./util.js";
import { chime, ensureContext } from "./audio.js";
import { load, save } from "./store.js";
import { cycleLength, phaseAt, breathNumber } from "./breath-math.js";

/** from / to は肺の膨らみ（0 = 吐ききり、1 = 吸いきり）。cue は合図音の高さ。 */
export const PATTERNS = {
  "4-7-8": {
    label: "4-7-8",
    tagline: "吸う4・止める7・吐く8",
    note: "呼気を吸気の倍にする配分。眠りにつく前の1セットに向く。",
    phases: [
      { label: "鼻から吸う", short: "吸う 4", seconds: 4, from: 0, to: 1, cue: 396 },
      { label: "止める", short: "止める 7", seconds: 7, from: 1, to: 1, cue: 330 },
      { label: "口から吐く", short: "吐く 8", seconds: 8, from: 1, to: 0, cue: 264 },
    ],
  },
  box: {
    label: "ボックス呼吸",
    tagline: "4・4・4・4",
    note: "四辺が等しい配分。落ち着かせつつ、眠り込みたくない場面にも使える。",
    phases: [
      { label: "吸う", short: "吸う 4", seconds: 4, from: 0, to: 1, cue: 396 },
      { label: "止める", short: "止める 4", seconds: 4, from: 1, to: 1, cue: 330 },
      { label: "吐く", short: "吐く 4", seconds: 4, from: 1, to: 0, cue: 264 },
      { label: "止める", short: "止める 4", seconds: 4, from: 0, to: 0, cue: 330 },
    ],
  },
  resonant: {
    label: "共鳴呼吸",
    tagline: "5.5秒ずつ",
    note: "毎分およそ5.5回。止める時間がないので長く続けやすい。NSDRと併走させるならこれが合う。",
    phases: [
      { label: "吸う", short: "吸う", seconds: 5.5, from: 0, to: 1, cue: 396 },
      { label: "吐く", short: "吐く", seconds: 5.5, from: 1, to: 0, cue: 264 },
    ],
  },
  sigh: {
    label: "生理的ため息",
    tagline: "二段で吸って長く吐く",
    note: "短時間で切り替えたいとき向け。1〜3回で十分。",
    phases: [
      { label: "吸う", short: "吸う", seconds: 1.5, from: 0, to: 0.72, cue: 396 },
      { label: "もう一口吸う", short: "もう一口", seconds: 1, from: 0.72, to: 1, cue: 440 },
      { label: "長く吐き切る", short: "長く吐く", seconds: 6, from: 1, to: 0, cue: 264 },
    ],
  },
};

const PREF_KEY = "breathe-prefs";

const prefs = load(PREF_KEY, { pattern: "4-7-8", cues: true, cycles: 8 });
if (!PATTERNS[prefs.pattern]) prefs.pattern = "4-7-8";

const wakeLock = createWakeLock();

let state = "idle";     // idle | running | done
let startedAt = 0;
let raf = 0;
let lastPhase = null;
let listener = null;

const phases = () => PATTERNS[prefs.pattern].phases;
const cycle = () => cycleLength(phases());
const totalSeconds = () => cycle() * prefs.cycles;

function elapsed() {
  return state === "running" ? (performance.now() - startedAt) / 1000 : 0;
}

/** ビューが描画に必要とする情報をひとまとめにしたもの。 */
function snapshot() {
  const time = elapsed();
  const { phase, local } = phaseAt(phases(), time);
  return {
    state,
    elapsed: time,
    phase,
    remaining: Math.max(1, Math.ceil(phase.seconds - local)),
    breath: Math.min(breathNumber(phases(), time), prefs.cycles),
    totalBreaths: prefs.cycles,
  };
}

function emit() {
  listener?.(snapshot());
}

function frame() {
  if (state !== "running") return;
  const time = elapsed();

  if (time >= totalSeconds()) return finish();

  // フェーズが変わった瞬間だけ合図を出す。画面が出ていなくても鳴る。
  const { phase } = phaseAt(phases(), time);
  if (phase !== lastPhase) {
    lastPhase = phase;
    if (prefs.cues) {
      chime({ frequency: phase.cue, duration: 0.8, volume: 0.16 });
      navigator.vibrate?.(phase === phases()[0] ? [40, 30, 40] : 30);
    }
  }

  emit();
  raf = requestAnimationFrame(frame);
}

function halt(nextState) {
  state = nextState;
  cancelAnimationFrame(raf);
  raf = 0;
  lastPhase = null;
  wakeLock.release();
}

function finish() {
  halt("done");
  if (prefs.cues) chime({ frequency: 330, duration: 1.6, volume: 0.14 });
  emit();
  onFinish?.();
}

let onFinish = null;

export const breathSession = {
  prefs,

  get running() { return state === "running"; },
  get state() { return state; },

  pattern() { return PATTERNS[prefs.pattern]; },

  savePrefs() { save(PREF_KEY, prefs); },

  setPattern(id) {
    if (!PATTERNS[id]) return;
    if (state === "running") this.stop();
    prefs.pattern = id;
    this.savePrefs();
    emit();
  },

  setCycles(count) {
    prefs.cycles = count;
    this.savePrefs();
    emit();
  },

  setCues(enabled) {
    prefs.cues = enabled;
    this.savePrefs();
  },

  start() {
    ensureContext();
    state = "running";
    startedAt = performance.now();
    lastPhase = null;
    wakeLock.acquire();
    frame();
  },

  stop() {
    halt("idle");
    emit();
  },

  toggle() {
    if (state === "running") this.stop(); else this.start();
  },

  /** セッション完了時に一度だけ呼ばれる通知（トースト用）。 */
  setFinishHandler(fn) { onFinish = fn; },

  /** 表示中のビューが描画関数を差し込む。差し込んだ直後に一度描画される。 */
  bind(fn) {
    listener = fn;
    emit();
  },

  unbind(fn) {
    if (listener === fn) listener = null;
  },

  snapshot,
};
