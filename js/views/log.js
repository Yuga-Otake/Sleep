/** 睡眠ログ。日々の記録を取り、指標とグラフ、床上時間の提案を返す。 */

import { el, todayISO, formatDateShort, formatDuration, toast } from "../util.js";
import { loadEntries, upsertEntry, removeEntry, load, save } from "../store.js";
import {
  metricsFor, recentMetrics, average, suggestWindow, averageRiseTime,
  MIN_ENTRIES, EFF_LOW, EFF_HIGH,
} from "../sleep-math.js";
import { renderEfficiencyChart } from "../chart.js";

const PREF_KEY = "log-prefs";

export function render(root) {
  const prefs = load(PREF_KEY, { riseTime: "" });
  let entries = loadEntries();

  const summary = el("div");
  const form = buildForm(onSubmit);
  const history = el("div");

  function onSubmit(entry) {
    if (!metricsFor(entry)) {
      toast("時刻を確認してください");
      return false;
    }
    entries = upsertEntry(entry);
    paint();
    toast(`${formatDateShort(entry.date)} の記録を保存しました`);
    return true;
  }

  function riseTime() {
    return prefs.riseTime || averageRiseTime(entries) || "07:00";
  }

  function paint() {
    summary.replaceChildren(...buildSummary(entries, riseTime(), (value) => {
      prefs.riseTime = value;
      save(PREF_KEY, prefs);
      paint();
    }));

    history.replaceChildren(...buildHistory(entries, (date) => {
      entries = removeEntry(date);
      paint();
    }));
  }

  paint();

  root.replaceChildren(
    el("h2", { id: "h-log", text: "睡眠ログ" }),
    el("p", { class: "lede", text: "記録は端末の中だけに保存されます。送信も同期もしません。" }),
    summary,
    el("div", { class: "card" }, [el("h3", { text: "記録する" }), form]),
    el("div", { class: "card" }, [el("h3", { text: "履歴" }), history]),
  );

  return () => {};
}

/* ---------- 集計・提案 ---------- */

function buildSummary(entries, riseTime, onRiseChange) {
  const metrics = recentMetrics(entries);
  const nodes = [];

  const avgEff = average(metrics.map((m) => m.efficiency));
  const avgSleep = average(metrics.map((m) => m.totalSleep));

  nodes.push(el("dl", { class: "stat-row" }, [
    stat("直近の平均効率", avgEff == null ? "—" : avgEff.toFixed(0), "%"),
    stat("平均睡眠時間", avgSleep == null ? "—" : (avgSleep / 60).toFixed(1), "時間"),
    stat("記録日数", String(entries.length), "日"),
  ]));

  const rows = metrics.map((m) => ({
    date: m.date,
    efficiency: m.efficiency,
    sleepLabel: formatDuration(m.totalSleep),
  }));
  nodes.push(el("div", { class: "card" }, [renderEfficiencyChart(rows)]));

  /* 就床時刻の提案 */
  const riseInput = el("input", {
    type: "time", id: "riseTime", value: riseTime,
    onchange: (e) => onRiseChange(e.target.value),
  });

  const suggestion = suggestWindow(entries, riseTime);
  const body = [];

  if (!suggestion.ready) {
    body.push(el("p", {
      class: "muted",
      text: `提案には${MIN_ENTRIES}日分の記録が必要です。あと${suggestion.needed}日。`,
    }));
  } else {
    const verdictText = {
      extend: `平均効率が ${EFF_HIGH}% 以上でした。床にいる時間を15分広げます。`,
      hold: `平均効率は ${EFF_LOW}〜${EFF_HIGH}% の範囲です。今の枠を維持します。`,
      compress: `平均効率が ${EFF_LOW}% を下回りました。床にいる時間を15分狭めます。`,
    }[suggestion.verdict];

    body.push(
      el("div", { class: "callout" }, [
        el("strong", { text: `今夜は ${suggestion.bedtime} 就床 → ${suggestion.riseTime} 起床` }),
        el("div", { class: "muted", style: "margin-top:4px" },
          [`床にいる時間 ${formatDuration(suggestion.windowMinutes)}（直近${suggestion.samples}日の平均効率 ${suggestion.avgEfficiency.toFixed(0)}%）`]),
      ]),
      el("p", { class: "hint", text: verdictText }),
      el("p", {
        class: "muted",
        text: "眠くなくても起床時刻は動かさず、眠れないときは一度床を離れる — という前提の目安です。",
      }),
    );
    if (suggestion.clamped) {
      body.push(el("p", { class: "muted", text: "枠は5〜9時間の範囲に収めています。" }));
    }
  }

  nodes.push(el("div", { class: "card" }, [
    el("h3", { text: "今夜の床上時間の目安" }),
    el("div", { style: "margin-bottom:12px" }, [
      el("label", { for: "riseTime", text: "固定する起床時刻" }),
      riseInput,
    ]),
    ...body,
  ]));

  return nodes;
}

function stat(label, value, unit) {
  return el("div", { class: "stat" }, [
    el("dt", { text: label }),
    el("dd", {}, [value, el("small", { text: unit })]),
  ]);
}

/* ---------- 入力フォーム ---------- */

function buildForm(onSubmit) {
  const field = (id, label, attrs) => el("div", {}, [
    el("label", { for: id, text: label }),
    el("input", { id, ...attrs }),
  ]);

  const form = el("form", { novalidate: true }, [
    el("div", { class: "field-grid" }, [
      field("d-date", "日付（起きた日）", { type: "date", value: todayISO(), required: true }),
      field("d-quality", "眠りの質 1〜5", { type: "number", min: "1", max: "5", step: "1", value: "3" }),
      field("d-bedtime", "就床（布団に入った）", { type: "time", value: "23:30", required: true }),
      field("d-wake", "起床（目が覚めた）", { type: "time", value: "07:00", required: true }),
      field("d-latency", "寝つくまで（分）", { type: "number", min: "0", max: "600", step: "5", value: "15" }),
      field("d-awake", "夜中に起きていた（分）", { type: "number", min: "0", max: "600", step: "5", value: "0" }),
      field("d-outofbed", "離床（床から出た）", { type: "time", value: "07:00" }),
    ]),
    el("button", { class: "btn btn-primary btn-block", type: "submit", style: "margin-top:14px" }, ["保存する"]),
  ]);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const get = (id) => form.querySelector(`#${id}`).value;
    const entry = {
      date: get("d-date") || todayISO(),
      bedtime: get("d-bedtime"),
      wake: get("d-wake"),
      outOfBed: get("d-outofbed") || get("d-wake"),
      latency: Number(get("d-latency")) || 0,
      awake: Number(get("d-awake")) || 0,
      quality: Number(get("d-quality")) || 3,
    };
    onSubmit(entry);
  });

  return form;
}

/* ---------- 履歴 ---------- */

function buildHistory(entries, onDelete) {
  if (!entries.length) {
    return [el("p", { class: "empty", text: "まだ記録がありません。" })];
  }

  const list = [...entries].reverse().map((entry) => {
    const m = metricsFor(entry);
    return el("div", { class: "log-item" }, [
      el("div", { class: "log-line" }, [
        el("span", { class: "log-date", text: formatDateShort(entry.date) }),
        el("span", { class: "log-eff", text: m ? `${m.efficiency.toFixed(0)}%` : "—" }),
      ]),
      el("div", { class: "muted" },
        [`${entry.bedtime} → ${entry.wake} ・ 睡眠 ${m ? formatDuration(m.totalSleep) : "—"} ・ 質 ${entry.quality}/5`]),
      el("button", {
        class: "btn btn-ghost btn-sm", type: "button", style: "justify-self:start;margin-top:4px",
        onclick: () => onDelete(entry.date),
      }, ["削除"]),
    ]);
  });

  list.push(el("button", {
    class: "btn btn-ghost btn-sm", type: "button", style: "margin-top:14px",
    onclick: () => exportCsv(entries),
  }, ["CSVで書き出す"]));

  return list;
}

/** 記録を手元に取り出せるようにする。アプリを離れてもデータが残るように。 */
function exportCsv(entries) {
  const header = "date,bedtime,wake,out_of_bed,latency_min,awake_min,quality,time_in_bed_min,total_sleep_min,efficiency_pct";
  const lines = entries.map((entry) => {
    const m = metricsFor(entry) || {};
    return [
      entry.date, entry.bedtime, entry.wake, entry.outOfBed,
      entry.latency, entry.awake, entry.quality,
      m.timeInBed ?? "", m.totalSleep ?? "",
      m.efficiency == null ? "" : m.efficiency.toFixed(1),
    ].join(",");
  });

  const blob = new Blob([`${header}\n${lines.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = el("a", { href: url, download: `sleep-log-${todayISO()}.csv` });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
