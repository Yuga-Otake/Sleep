/**
 * 呼吸ガイドの画面。
 *
 * 時間管理とパターンは breathSession が持つ。ここは描画だけを担当し、
 * マウント中だけセッションに描画関数を差し込む。画面を離れてもセッションは
 * 止まらない（NSDR やサウンドと同時に走らせるため）。
 */

import { el, formatClock, toast } from "../util.js";
import { chime, ensureContext } from "../audio.js";
import { createBreathGraph } from "../breath-graph.js";
import { breathSession, PATTERNS } from "../breath-session.js";

export function render(root) {
  const prefs = breathSession.prefs;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const graph = createBreathGraph({ reducedMotion });

  const phaseText = el("div", { class: "breath-phase" });
  const countText = el("div", { class: "breath-count" });
  const metaText = el("div", { class: "breath-meta" });

  const startBtn = el("button", { class: "btn btn-block", type: "button" });
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

  function paintPattern() {
    patternChips.replaceChildren();
    for (const [id, spec] of Object.entries(PATTERNS)) {
      patternChips.append(el("button", {
        class: "chip", type: "button", "aria-pressed": String(id === prefs.pattern),
        onclick: () => {
          breathSession.setPattern(id);
          paintPattern();
          graph.setPattern(breathSession.pattern().phases);
          noteText.textContent = breathSession.pattern().note;
        },
      }, [`${spec.label} · ${spec.tagline}`]));
    }
    noteText.textContent = breathSession.pattern().note;
  }

  /** セッションから届いた状態を画面に写す。 */
  function paint(snap) {
    graph.update(snap.elapsed);

    if (snap.state === "running") {
      phaseText.textContent = snap.phase.label;
      countText.textContent = String(snap.remaining);
      metaText.textContent = `${snap.breath} / ${snap.totalBreaths} 呼吸 ・ ${formatClock(snap.elapsed)}`;
      startBtn.textContent = "停止";
      startBtn.classList.remove("btn-primary");
    } else {
      phaseText.textContent = snap.state === "done" ? "おつかれさま" : "準備ができたら";
      countText.textContent = "";
      metaText.textContent = snap.state === "done"
        ? `${snap.totalBreaths} 呼吸が終わりました`
        : "開始を押してください";
      startBtn.textContent = "開始";
      startBtn.classList.add("btn-primary");
    }
  }

  startBtn.addEventListener("click", () => breathSession.toggle());
  cueToggle.addEventListener("click", () => {
    const next = !prefs.cues;
    breathSession.setCues(next);
    cueToggle.setAttribute("aria-checked", String(next));
    if (next) { ensureContext(); chime({ frequency: 396, duration: 0.5, volume: 0.14 }); }
  });
  cyclesSelect.addEventListener("change", () => breathSession.setCycles(Number(cyclesSelect.value)));

  paintPattern();
  graph.setPattern(breathSession.pattern().phases);
  breathSession.setFinishHandler(() => toast("呼吸のセッションが終わりました"));

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
      el("p", { class: "muted", style: "margin-top:12px" },
        ["他の画面へ移っても続きます。NSDR や サウンドと重ねて使えます。"]),
    ]),
  );

  breathSession.bind(paint);
  return () => breathSession.unbind(paint);
}
