/** ルーティングと全体のトグル。画面ごとの中身は js/views/ に分かれている。 */

import { el, toast } from "./util.js";
import { load, save } from "./store.js";
import { stopAllLayers, anyPlaying } from "./audio.js";
import { breathSession } from "./breath-session.js";
import { nsdrSession } from "./nsdr-session.js";

import * as breathe from "./views/breathe.js";
import * as sounds from "./views/sounds.js";
import * as nsdr from "./views/nsdr.js";
import * as logView from "./views/log.js";
import * as rhythm from "./views/rhythm.js";

const VIEWS = {
  breathe: { module: breathe, title: "呼吸ガイド" },
  sounds: { module: sounds, title: "サウンド" },
  nsdr: { module: nsdr, title: "NSDR" },
  log: { module: logView, title: "睡眠ログ" },
  rhythm: { module: rhythm, title: "1日のリズム" },
};

const DEFAULT_VIEW = "breathe";

let current = null;
let cleanup = null;

function routeName() {
  const name = location.hash.replace(/^#\/?/, "");
  return VIEWS[name] ? name : DEFAULT_VIEW;
}

function show(name) {
  if (name === current) return;

  // 前の画面のタイマーやアニメーションを必ず止めてから差し替える。
  cleanup?.();
  cleanup = null;

  for (const key of Object.keys(VIEWS)) {
    document.getElementById(`view-${key}`).hidden = key !== name;
  }
  for (const link of document.querySelectorAll(".tabbar a")) {
    const active = link.dataset.tab === name;
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }

  const root = document.getElementById(`view-${name}`);
  cleanup = VIEWS[name].module.render(root) || null;
  current = name;
  document.title = `${VIEWS[name].title} — Nocturne`;
}

/* ---------- 減光モード ---------- */

function setupDim() {
  const button = document.getElementById("dimBtn");
  let on = load("dim", false);

  const apply = () => {
    document.documentElement.dataset.dim = on ? "on" : "off";
    button.setAttribute("aria-pressed", String(on));
  };

  button.addEventListener("click", () => {
    on = !on;
    save("dim", on);
    apply();
    toast(on ? "減光モード オン" : "減光モード オフ");
  });

  apply();
}

/* ---------- 全停止 ---------- */

function setupStopAll() {
  document.getElementById("stopAllBtn").addEventListener("click", () => {
    const wasActive = anyPlaying() || breathSession.running || nsdrSession.running;
    stopAllLayers();
    breathSession.stop();
    nsdrSession.stop();
    toast(wasActive ? "すべて停止しました" : "動いているものはありません");
  });
}

/**
 * 走っているセッションのタブに印をつける。呼吸と NSDR は画面を離れても
 * 続くので、どこかで動いていることが常に見えるようにしておく。
 */
function setupRunningMarks() {
  const marks = {
    breathe: () => breathSession.running,
    nsdr: () => nsdrSession.running,
    sounds: () => anyPlaying(),
  };

  const refresh = () => {
    for (const [tab, isRunning] of Object.entries(marks)) {
      const link = document.querySelector(`.tabbar a[data-tab="${tab}"]`);
      if (link) link.dataset.running = String(isRunning());
    }
  };

  refresh();
  setInterval(refresh, 1000);
}

function addFooter() {
  document.body.insertBefore(
    el("footer", { class: "legal" }, [
      el("p", { class: "muted" }, [
        "このアプリは体調を管理・診断するものではありません。眠れない状態が数週間続く、",
        "日中の眠気が強い、いびきや呼吸の乱れを指摘された場合は、医療機関に相談してください。",
      ]),
    ]),
    document.querySelector(".tabbar"),
  );
}

window.addEventListener("hashchange", () => show(routeName()));

addFooter();
setupDim();
setupStopAll();
setupRunningMarks();
show(routeName());
