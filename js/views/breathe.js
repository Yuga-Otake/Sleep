/**
 * 呼吸ガイド。波形グラフの上をドットが進み、ドットの大きさが息の深さを表す。
 *
 * 時間の扱いは「セッション開始からの連続した秒数」ひとつだけ。フェーズも
 * 呼吸数もそこから導出するので、フェーズごとにタイマーを持ち回す必要がない。
 */

import { el, formatClock, toast, createWakeLock } from "../util.js";
import { chime, ensureContext } from "../audio.js";
import { load, save } from "../store.js";
import { createBreathGraph } from "../breath-graph.js";

/**
 * from / to は肺の膨らみ（0 = 吐ききり、1 = 吸いきり）。
 * short はグラフの目盛りに出す短い名前、cue はフェーズ開始時の合図音の高さ。
 */
const PATTERNS = {
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
    note: "毎分およそ5.5回。止める時間がないので長く続けやすい。",
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

export function render(root) {
  const prefs = load(PREF_KEY, { pattern: "4-7-8", cues: true, cycles: 8 });
  if (!PATTERNS[prefs.pattern]) prefs.pattern = "4-7-8";

  const wakeLock = createWakeLock();
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const graph = createBreathGraph({ reducedMotion });

  const phaseText = el("div", { class: "breath-phase", text: "準備ができたら" });
  const countText = el("div", { class: "breath-count", text: "" });
  const metaText = el("div", { class: "breath-meta", text: "開始を押してください" });

  const startBtn = el("button", { class: "btn btn-primary btn-block", type: "button", text: "開始" });
  const patternChips = el("div", { class: "chips", role: "group", "aria-label": "呼吸パターン" });
  const noteText = el("p", { class: "muted" });

  const cueToggle = el("button", {
    class: "chip", type: "button", role: "switch",
    "aria-checked": String(prefs.cues), text: "合図音",
  });

  const cyclesSelect = el("select", { id: "cycles", "aria-label": "回数" });
  for (const n of [3, 5, 8, 12, 20]) {
    cyclesSelect.append(el("option", { value: n, text: `${n}回`, selected: prefs.cycles === n }));
  }

  /* ---------- 状態 ---------- */

  let raf = 0;
  let running = false;
  let sessionStart = 0;
  let lastPhase = null;

  const pattern = () => PATTERNS[prefs.pattern];
  const cycleLength = () => pattern().phases.reduce((sum, phase) => sum + phase.seconds, 0);

  function applyPattern() {
    graph.setPattern(pattern().phases);
    noteText.textContent = pattern().note;
  }

  function paintPattern() {
    patternChips.replaceChildren();
    for (const [id, spec] of Object.entries(PATTERNS)) {
      patternChips.append(el("button", {
        class: "chip", type: "button", "aria-pressed": String(id === prefs.pattern),
        onclick: () => {
          if (running) stop();
          prefs.pattern = id;
          save(PREF_KEY, prefs);
          paintPattern();
          applyPattern();
        },
      }, [`${spec.label} · ${spec.tagline}`]));
    }
  }

  function announce(phase) {
    phaseText.textContent = phase.label;
    if (!prefs.cues) return;
    chime({ frequency: phase.cue, duration: 0.8, volume: 0.16 });
    navigator.vibrate?.(phase === pattern().phases[0] ? [40, 30, 40] : 30);
  }

  function tick(now) {
    if (!running) return;
    const elapsed = (now - sessionStart) / 1000;

    if (elapsed >= cycleLength() * prefs.cycles) return finish();

    graph.update(elapsed);

    const { phase, local } = graph.phaseInfo(elapsed);
    if (phase !== lastPhase) {
      lastPhase = phase;
      announce(phase);
    }

    countText.textContent = String(Math.max(1, Math.ceil(phase.seconds - local)));
    const breaths = Math.floor(elapsed / cycleLength()) + 1;
    metaText.textContent = `${breaths} / ${prefs.cycles} 呼吸 ・ ${formatClock(elapsed)}`;

    raf = requestAnimationFrame(tick);
  }

  function start() {
    ensureContext();
    running = true;
    lastPhase = null;
    sessionStart = performance.now();
    startBtn.textContent = "停止";
    startBtn.classList.remove("btn-primary");
    wakeLock.acquire();
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    wakeLock.release();
    startBtn.textContent = "開始";
    startBtn.classList.add("btn-primary");
    phaseText.textContent = "準備ができたら";
    countText.textContent = "";
    metaText.textContent = "開始を押してください";
    graph.update(0);
  }

  function finish() {
    stop();
    phaseText.textContent = "おつかれさま";
    metaText.textContent = `${prefs.cycles} 呼吸が終わりました`;
    if (prefs.cues) chime({ frequency: 330, duration: 1.6, volume: 0.14 });
    toast("セッション完了");
  }

  startBtn.addEventListener("click", () => (running ? stop() : start()));
  cueToggle.addEventListener("click", () => {
    prefs.cues = !prefs.cues;
    cueToggle.setAttribute("aria-checked", String(prefs.cues));
    save(PREF_KEY, prefs);
    if (prefs.cues) { ensureContext(); chime({ frequency: 396, duration: 0.5, volume: 0.14 }); }
  });
  cyclesSelect.addEventListener("change", () => {
    prefs.cycles = Number(cyclesSelect.value);
    save(PREF_KEY, prefs);
  });

  paintPattern();
  applyPattern();

  root.replaceChildren(
    el("h2", { id: "h-breathe", text: "呼吸ガイド" }),
    el("p", { class: "lede", text: "ドットの高さが息の深さ。上の「吸いきり」線に届くまで吸い、下の線まで吐き切ります。" }),
    el("div", { class: "card" }, [
      el("div", { class: "breath-stage" }, [graph.node]),
      el("div", { class: "breath-readout" }, [
        el("div", {}, [phaseText, metaText]),
        countText,
      ]),
      startBtn,
    ]),
    el("div", { class: "card" }, [
      el("h3", { text: "パターン" }),
      patternChips,
      noteText,
    ]),
    el("div", { class: "card" }, [
      el("h3", { text: "設定" }),
      el("div", { class: "row" }, [
        el("label", { for: "cycles", text: "1セットの呼吸数" }),
        el("div", { style: "width:120px" }, [cyclesSelect]),
      ]),
      el("div", { class: "row", style: "margin-top:12px" }, [
        el("span", { class: "muted", text: "フェーズの切り替わりを音と振動で知らせます" }),
        cueToggle,
      ]),
    ]),
  );

  return () => { stop(); };
}
