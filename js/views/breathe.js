/** 呼吸ガイド。パターンを選び、円の拡縮と数字のカウントダウンで誘導する。 */

import { el, formatClock, toast, createWakeLock } from "../util.js";
import { chime, ensureContext } from "../audio.js";
import { load, save } from "../store.js";

/**
 * 各パターンは phases の並びで定義する。from / to は円の相対サイズで、
 * 吸う=拡大 / 吐く=縮小 / 止める=保持 を表す。cue は合図音の高さ。
 */
const PATTERNS = {
  "4-7-8": {
    label: "4-7-8",
    tagline: "吸う4・止める7・吐く8",
    note: "呼気を吸気の倍にする配分。眠りにつく前の1セットに向く。",
    phases: [
      { label: "鼻から吸う", seconds: 4, from: 0.55, to: 1, cue: 396 },
      { label: "止める", seconds: 7, from: 1, to: 1, cue: 330 },
      { label: "口から吐く", seconds: 8, from: 1, to: 0.55, cue: 264 },
    ],
  },
  box: {
    label: "ボックス呼吸",
    tagline: "4・4・4・4",
    note: "四辺が等しい配分。落ち着かせつつ、眠り込みたくない場面にも使える。",
    phases: [
      { label: "吸う", seconds: 4, from: 0.55, to: 1, cue: 396 },
      { label: "止める", seconds: 4, from: 1, to: 1, cue: 330 },
      { label: "吐く", seconds: 4, from: 1, to: 0.55, cue: 264 },
      { label: "止める", seconds: 4, from: 0.55, to: 0.55, cue: 330 },
    ],
  },
  resonant: {
    label: "共鳴呼吸",
    tagline: "5.5秒ずつ",
    note: "毎分およそ5.5回。止める時間がないので長く続けやすい。",
    phases: [
      { label: "吸う", seconds: 5.5, from: 0.55, to: 1, cue: 396 },
      { label: "吐く", seconds: 5.5, from: 1, to: 0.55, cue: 264 },
    ],
  },
  sigh: {
    label: "生理的ため息",
    tagline: "二段で吸って長く吐く",
    note: "短時間で切り替えたいとき向け。1〜3回で十分。",
    phases: [
      { label: "吸う", seconds: 1.5, from: 0.55, to: 0.85, cue: 396 },
      { label: "もう一口吸う", seconds: 1, from: 0.85, to: 1, cue: 440 },
      { label: "長く吐き切る", seconds: 6, from: 1, to: 0.55, cue: 264 },
    ],
  },
};

const PREF_KEY = "breathe-prefs";

export function render(root) {
  const prefs = load(PREF_KEY, { pattern: "4-7-8", cues: true, cycles: 8 });
  if (!PATTERNS[prefs.pattern]) prefs.pattern = "4-7-8";

  const wakeLock = createWakeLock();

  const phaseText = el("div", { class: "breath-phase", text: "準備ができたら" });
  const countText = el("div", { class: "breath-count", text: "—" });
  const metaText = el("div", { class: "breath-meta", text: "開始を押してください" });
  const halo = el("div", { class: "breath-halo" });
  const ring = el("div", { class: "breath-ring" });

  const stage = el("div", { class: "breath-stage" }, [
    halo, ring,
    el("div", { class: "breath-copy" }, [phaseText, countText, metaText]),
  ]);

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
  let phaseIndex = 0;
  let cycleCount = 0;
  let phaseStart = 0;
  let sessionStart = 0;

  const pattern = () => PATTERNS[prefs.pattern];

  function setScale(value) {
    stage.style.setProperty("--s", value.toFixed(3));
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
        },
      }, [`${spec.label} · ${spec.tagline}`]));
    }
    noteText.textContent = pattern().note;
  }

  function enterPhase(index) {
    phaseIndex = index;
    phaseStart = performance.now();
    const phase = pattern().phases[index];
    phaseText.textContent = phase.label;
    if (prefs.cues) {
      chime({ frequency: phase.cue, duration: 0.8, volume: 0.16 });
      navigator.vibrate?.(index === 0 ? [40, 30, 40] : 30);
    }
  }

  function tick(now) {
    if (!running) return;
    const phases = pattern().phases;
    const phase = phases[phaseIndex];
    const elapsed = (now - phaseStart) / 1000;
    const progress = Math.min(1, elapsed / phase.seconds);

    setScale(phase.from + (phase.to - phase.from) * progress);
    countText.textContent = String(Math.max(1, Math.ceil(phase.seconds - elapsed)));
    metaText.textContent = `${cycleCount + 1} / ${prefs.cycles} 呼吸 ・ ${formatClock((now - sessionStart) / 1000)}`;

    if (progress >= 1) {
      const next = phaseIndex + 1;
      if (next >= phases.length) {
        cycleCount += 1;
        if (cycleCount >= prefs.cycles) return finish();
        enterPhase(0);
      } else {
        enterPhase(next);
      }
    }
    raf = requestAnimationFrame(tick);
  }

  function start() {
    ensureContext();
    running = true;
    cycleCount = 0;
    sessionStart = performance.now();
    startBtn.textContent = "停止";
    startBtn.classList.remove("btn-primary");
    wakeLock.acquire();
    enterPhase(0);
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    wakeLock.release();
    startBtn.textContent = "開始";
    startBtn.classList.add("btn-primary");
    phaseText.textContent = "準備ができたら";
    countText.textContent = "—";
    metaText.textContent = "開始を押してください";
    setScale(0.55);
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

  setScale(0.55);
  paintPattern();

  root.replaceChildren(
    el("h2", { id: "h-breathe", text: "呼吸ガイド" }),
    el("p", { class: "lede", text: "円の拡がりに合わせて吸い、縮みに合わせて吐く。息を止める区間は円が止まります。" }),
    el("div", { class: "card" }, [stage, startBtn]),
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
