/**
 * 睡眠効率の日次バーチャート (単一系列)。
 *
 * 形の選択: 「日ごとの大きさを比べる」用途なので、ゼロ基線から伸びるバー。
 * 系列が 1 本なので凡例は置かず、見出しが系列名を兼ねる。直接ラベルは
 * 最新日だけに絞り、残りの値はホバー/フォーカス時のツールチップと
 * 表ビューで読めるようにしている。
 */

import { el, formatDateShort } from "./util.js";

const W = 320;
const H = 154;
const PAD = { top: 20, right: 8, bottom: 22, left: 26 };
const BAR_MAX = 24;   // バーの最大太さ。帯を埋め切らず余白を残す
const GAP = 2;        // 隣り合うバーを分けるサーフェス色の隙間
const RADIUS = 4;     // データ端の丸め。基線側は角のまま
const TARGET = 85;    // 睡眠効率の目安ライン (%)

const svg = (tag, attrs = {}) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

/** 上端だけを丸めたバーのパス。 */
function barPath(x, y, width, height) {
  const r = Math.min(RADIUS, width / 2, height);
  if (height <= 0) return "";
  return `M${x},${y + height} L${x},${y + r} Q${x},${y} ${x + r},${y} `
       + `L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} `
       + `L${x + width},${y + height} Z`;
}

/**
 * @param {{date:string, efficiency:number, sleep:number}[]} rows 古い順
 */
export function renderEfficiencyChart(rows) {
  const figure = el("figure", { class: "chart-figure" }, [
    el("figcaption", { text: "直近の睡眠効率（眠っていた時間 ÷ 床にいた時間）。破線は目安の85%。" }),
  ]);

  if (!rows.length) {
    figure.append(el("p", { class: "empty", text: "記録が増えるとここにグラフが出ます。" }));
    return figure;
  }

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const band = plotW / rows.length;
  const barW = Math.min(BAR_MAX, band - GAP);
  const yOf = (value) => PAD.top + plotH * (1 - value / 100);

  const root = svg("svg", {
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": `直近${rows.length}日間の睡眠効率のグラフ。詳しい数値は下の表を参照。`,
  });

  // 目盛り: 0 / 50 / 100 のみ。目盛り線は前面のバーより後退した色。
  for (const tick of [0, 50, 100]) {
    const y = yOf(tick);
    root.append(svg("line", { class: "chart-grid", x1: PAD.left, x2: W - PAD.right, y1: y, y2: y }));
    const label = svg("text", { class: "chart-axis", x: PAD.left - 6, y: y + 3, "text-anchor": "end" });
    label.textContent = String(tick);
    root.append(label);
  }

  // 目安ライン (85%)。ラベルは目盛りと同じ左の余白に置き、
  // バーや直接ラベルと重ならないようにする。
  const targetY = yOf(TARGET);
  root.append(svg("line", { class: "chart-ref", x1: PAD.left, x2: W - PAD.right, y1: targetY, y2: targetY }));
  const targetLabel = svg("text", { class: "chart-axis chart-ref-label", x: PAD.left - 6, y: targetY + 3, "text-anchor": "end" });
  targetLabel.textContent = String(TARGET);
  root.append(targetLabel);

  const tip = el("div", { class: "chart-tip", hidden: true, role: "status" });

  rows.forEach((row, i) => {
    const value = Math.max(0, Math.min(100, row.efficiency));
    const x = PAD.left + band * i + (band - barW) / 2;
    const y = yOf(value);
    const height = PAD.top + plotH - y;

    // 当たり判定はバーより広く取り、細いバーでも掴めるようにする。
    const hit = svg("rect", {
      class: "chart-hit",
      x: PAD.left + band * i,
      y: PAD.top,
      width: band,
      height: plotH,
      tabindex: "0",
      role: "img",
      "aria-label": `${formatDateShort(row.date)} 睡眠効率 ${value.toFixed(0)}パーセント`,
    });
    const show = () => {
      tip.hidden = false;
      tip.textContent = `${formatDateShort(row.date)} ・ 効率 ${value.toFixed(0)}%`;
    };
    const hide = () => { tip.hidden = true; };
    hit.addEventListener("pointerenter", show);
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("focus", show);
    hit.addEventListener("blur", hide);

    root.append(hit, svg("path", { class: "chart-bar", d: barPath(x, y, barW, height) }));

    const dateLabel = svg("text", {
      class: "chart-axis",
      x: PAD.left + band * i + band / 2,
      y: H - 6,
      "text-anchor": "middle",
    });
    dateLabel.textContent = formatDateShort(row.date).replace(/\(.\)$/, "");
    root.append(dateLabel);

    // 直接ラベルは最新日だけ。全点に付けるとラベルとして機能しなくなる。
    if (i === rows.length - 1 && height > 12) {
      const valueLabel = svg("text", { class: "chart-label", x: x + barW / 2, y: y - 5 });
      valueLabel.textContent = `${value.toFixed(0)}%`;
      root.append(valueLabel);
    }
  });

  figure.append(el("div", { class: "chart" }, [root, tip]));
  figure.append(tableView(rows));
  return figure;
}

function tableView(rows) {
  const body = el("tbody");
  for (const row of [...rows].reverse()) {
    body.append(el("tr", {}, [
      el("th", { scope: "row", text: formatDateShort(row.date) }),
      el("td", { text: `${row.efficiency.toFixed(0)}%` }),
      el("td", { text: row.sleepLabel }),
    ]));
  }

  return el("details", { class: "disclosure" }, [
    el("summary", { text: "数値で見る" }),
    el("div", { class: "table-scroll" }, [
      el("table", { class: "data" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { scope: "col", text: "日付" }),
            el("th", { scope: "col", text: "効率" }),
            el("th", { scope: "col", text: "睡眠時間" }),
          ]),
        ]),
        body,
      ]),
    ]),
  ]);
}
