/**
 * 呼吸ガイドの波形グラフ。
 *
 * 縦軸は肺の膨らみ（0 = 吐ききり、1 = 吸いきり）。波形は右から左へ流れ、
 * 「いま」の位置は動かない。ドットは波形の上を上下しつつ、膨らみに応じて
 * 自身の大きさも変わる ── 拡がる円とグラフを1つにまとめたもの。
 *
 * 動きを減らす設定の端末では流れを止め、1呼吸ぶんの波形を固定表示して
 * ドットだけを動かす。
 *
 * 毎フレーム DOM を作り直さず、生成済みノードの属性だけを書き換える。
 */

const NS = "http://www.w3.org/2000/svg";

const W = 340;
const H = 150;
const PAD = { top: 20, right: 14, bottom: 26, left: 38 };
const PW = W - PAD.left - PAD.right;
const PH = H - PAD.top - PAD.bottom;

const WIN_PAST = 4;      // 「いま」より前に見える秒数
const WIN_FUTURE = 8;    // 「いま」より先に見える秒数
const SPAN = WIN_PAST + WIN_FUTURE;
const SAMPLES = 120;     // 波形1本あたりのサンプル数
const MARKER_POOL = 8;   // フェーズ名ラベルの使い回し数

const DOT_MIN = 4;       // 吐ききりのドット半径
const DOT_MAX = 14;      // 吸いきりのドット半径

/** 呼吸らしい加減速。始まりと終わりがゆっくりで、途中が速い。 */
const ease = (p) => 0.5 - 0.5 * Math.cos(Math.PI * p);

const node = (tag, attrs = {}) => {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  return element;
};

const yOf = (fullness) => PAD.top + PH * (1 - fullness);

/**
 * @param {{reducedMotion?: boolean}} options
 */
export function createBreathGraph({ reducedMotion = false } = {}) {
  let phases = [];
  let cycle = 0;

  const root = node("svg", {
    viewBox: `0 0 ${W} ${H}`,
    class: "breath-graph",
    role: "img",
    "aria-label": "呼吸の波形。上ほど息を吸った状態を表す。",
  });

  /* 動かない部分 */
  for (const [value, label] of [[1, "吸いきり"], [0, "吐ききり"]]) {
    root.append(node("line", {
      class: "bg-guide", x1: PAD.left, x2: W - PAD.right, y1: yOf(value), y2: yOf(value),
    }));
    const text = node("text", { class: "bg-tick", x: PAD.left - 6, y: yOf(value) + 3.5, "text-anchor": "end" });
    text.textContent = label;
    root.append(text);
  }
  root.append(node("line", {
    class: "bg-axis", x1: PAD.left, x2: W - PAD.right, y1: PAD.top + PH, y2: PAD.top + PH,
  }));

  const nowX = reducedMotion ? null : PAD.left + PW * (WIN_PAST / SPAN);
  if (!reducedMotion) {
    root.append(node("line", { class: "bg-now", x1: nowX, x2: nowX, y1: PAD.top - 6, y2: PAD.top + PH }));
  }

  /* 毎フレーム書き換える部分 */
  const fill = node("path", { class: "bg-fill", d: "" });
  const pastLine = node("path", { class: "bg-past", d: "" });
  const futureLine = node("path", { class: "bg-future", d: "" });
  const halo = node("circle", { class: "bg-halo", cx: 0, cy: 0, r: 0 });
  const dot = node("circle", { class: "bg-dot", cx: 0, cy: 0, r: 0 });

  const markers = Array.from({ length: MARKER_POOL }, () => {
    const group = node("g", { class: "bg-marker", opacity: "0" });
    const tick = node("line", { y1: PAD.top + PH - 5, y2: PAD.top + PH, x1: 0, x2: 0 });
    const text = node("text", { class: "bg-mark-text", y: H - 8, "text-anchor": "middle", x: 0 });
    group.append(tick, text);
    root.append(group);
    return { group, tick, text };
  });

  root.append(fill, pastLine, futureLine, halo, dot);

  /* ---------- 波形の計算 ---------- */

  /** サイクル内の時刻 t における、そのフェーズと経過秒。 */
  function phaseAt(t) {
    let start = 0;
    for (const phase of phases) {
      if (t < start + phase.seconds) return { phase, local: t - start, start };
      start += phase.seconds;
    }
    const last = phases[phases.length - 1];
    return { phase: last, local: last.seconds, start: cycle - last.seconds };
  }

  /** 任意の時刻の膨らみ（0〜1）。サイクルをまたいでも連続する。 */
  function fullnessAt(t) {
    if (!cycle) return 0;
    const inCycle = ((t % cycle) + cycle) % cycle;
    const { phase, local } = phaseAt(inCycle);
    return phase.from + (phase.to - phase.from) * ease(local / phase.seconds);
  }

  /** 秒の範囲を折れ線のパス文字列にする。 */
  function pathFor(fromSec, toSec, xOf) {
    let d = "";
    for (let i = 0; i <= SAMPLES; i++) {
      const sec = fromSec + (toSec - fromSec) * (i / SAMPLES);
      d += `${i ? "L" : "M"}${xOf(sec).toFixed(2)},${yOf(fullnessAt(sec)).toFixed(2)}`;
    }
    return d;
  }

  function hideMarkersFrom(index) {
    for (let i = index; i < markers.length; i++) markers[i].group.setAttribute("opacity", "0");
  }

  /** フェーズの区切りと名前を、見えている範囲だけ配置する。 */
  function placeMarkers(fromSec, toSec, nowSec, xOf) {
    let used = 0;
    const firstCycle = Math.floor(fromSec / cycle);

    for (let c = firstCycle; c <= firstCycle + Math.ceil(SPAN / cycle) + 1; c++) {
      let start = c * cycle;
      for (const phase of phases) {
        const middle = start + phase.seconds / 2;
        if (middle > fromSec + 0.5 && middle < toSec - 0.5 && used < markers.length) {
          const marker = markers[used++];
          marker.text.textContent = phase.short;
          marker.text.setAttribute("x", xOf(middle).toFixed(2));
          marker.tick.setAttribute("x1", xOf(start).toFixed(2));
          marker.tick.setAttribute("x2", xOf(start).toFixed(2));
          // 進行中とこれから来るフェーズを濃く、終わったものだけ薄く。
          const ended = start + phase.seconds < nowSec;
          marker.group.setAttribute("opacity", ended ? "0.45" : "1");
        }
        start += phase.seconds;
      }
    }
    hideMarkersFrom(used);
  }

  /* ---------- 更新 ---------- */

  function update(t) {
    if (!cycle) return;

    const time = Math.max(0, t);
    const fullness = fullnessAt(time);

    let cursorX;
    if (reducedMotion) {
      // 流さず、1呼吸ぶんを固定表示。動くのはドットだけ。
      const inCycle = ((time % cycle) + cycle) % cycle;
      const xOf = (sec) => PAD.left + PW * (sec / cycle);
      cursorX = xOf(inCycle);
      // 過去と未来で線を分ける。重ねて描くと過去の色が上書きされてしまう。
      pastLine.setAttribute("d", inCycle > 0 ? pathFor(0, inCycle, xOf) : "");
      futureLine.setAttribute("d", pathFor(inCycle, cycle, xOf));
      fill.setAttribute("d", inCycle > 0
        ? `${pathFor(0, inCycle, xOf)} L${cursorX.toFixed(2)},${PAD.top + PH} L${PAD.left},${PAD.top + PH} Z`
        : "");
      placeMarkers(0, cycle, inCycle, xOf);
    } else {
      const from = time - WIN_PAST;
      const to = time + WIN_FUTURE;
      const xOf = (sec) => PAD.left + PW * ((sec - from) / SPAN);
      cursorX = nowX;
      pastLine.setAttribute("d", pathFor(from, time, xOf));
      futureLine.setAttribute("d", pathFor(time, to, xOf));
      fill.setAttribute("d",
        `${pathFor(from, time, xOf)} L${nowX.toFixed(2)},${PAD.top + PH} L${PAD.left},${PAD.top + PH} Z`);
      placeMarkers(from, to, time, xOf);
    }

    // ドットは波形をなぞりつつ、膨らみに応じて自分の大きさも変える。
    const radius = DOT_MIN + (DOT_MAX - DOT_MIN) * fullness;
    const cy = yOf(fullness);
    dot.setAttribute("cx", cursorX.toFixed(2));
    dot.setAttribute("cy", cy.toFixed(2));
    dot.setAttribute("r", radius.toFixed(2));
    halo.setAttribute("cx", cursorX.toFixed(2));
    halo.setAttribute("cy", cy.toFixed(2));
    halo.setAttribute("r", (radius * 2.3).toFixed(2));
  }

  return {
    node: root,

    /** パターンを差し替える。phases は {short, seconds, from, to} を持つ配列。 */
    setPattern(nextPhases) {
      phases = nextPhases;
      cycle = phases.reduce((sum, phase) => sum + phase.seconds, 0);
      update(0);
    },

    update,

    /** 現在時刻におけるフェーズ情報。カウントダウン表示に使う。 */
    phaseInfo(t) {
      const inCycle = ((Math.max(0, t) % cycle) + cycle) % cycle;
      return phaseAt(inCycle);
    },
  };
}
