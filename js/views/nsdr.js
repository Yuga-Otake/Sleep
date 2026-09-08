/**
 * NSDR / ボディスキャンの画面。
 *
 * 台本の進行と読み上げは nsdrSession が持つ。ここは描画だけを担当し、
 * 画面を離れてもセッションは続く（呼吸ガイドやサウンドと併走できる）。
 */

import { el, formatClock, toast } from "../util.js";
import { nsdrSession, speechSupported } from "../nsdr-session.js";

export function render(root) {
  const prefs = nsdrSession.prefs;

  const line = el("div", { class: "session-script", "aria-live": "polite" });
  const bar = el("i");
  const progress = el("div", { class: "progress" }, [bar]);
  const clock = el("span", { class: "timer-state" });
  const startBtn = el("button", { class: "btn btn-block", type: "button" });
  const sessionChips = el("div", { class: "chips", role: "group", "aria-label": "セッションの長さ" });
  const noteText = el("span", { class: "muted" });

  const voiceToggle = el("button", {
    class: "chip", type: "button", role: "switch",
    "aria-checked": String(prefs.voice && speechSupported),
    disabled: !speechSupported,
    text: speechSupported ? "音声で読み上げ" : "読み上げ非対応",
  });

  function paintSessions() {
    sessionChips.replaceChildren();
    for (const [id, spec] of Object.entries(nsdrSession.SESSIONS)) {
      sessionChips.append(el("button", {
        class: "chip", type: "button", "aria-pressed": String(id === prefs.session),
        onclick: () => {
          nsdrSession.setSession(id);
          paintSessions();
        },
      }, [spec.label]));
    }
  }

  /** セッションから届いた状態を画面に写す。 */
  function paint(snap) {
    clock.textContent = `${formatClock(snap.elapsed)} / ${formatClock(snap.total)}`;
    bar.style.width = `${Math.min(100, (snap.elapsed / snap.total) * 100)}%`;
    noteText.textContent = snap.session.note;

    if (snap.state === "running") {
      line.textContent = snap.line ?? snap.session.note;
      startBtn.textContent = "終了";
      startBtn.classList.remove("btn-primary");
    } else {
      line.textContent = snap.state === "done"
        ? "おつかれさま。"
        : "静かな場所で横になれる状態にしてから始めてください。";
      startBtn.textContent = "開始";
      startBtn.classList.add("btn-primary");
    }
  }

  startBtn.addEventListener("click", () => nsdrSession.toggle());
  voiceToggle.addEventListener("click", () => {
    const next = !prefs.voice;
    nsdrSession.setVoice(next);
    voiceToggle.setAttribute("aria-checked", String(next));
  });

  paintSessions();
  nsdrSession.setFinishHandler(() => toast("NSDR のセッションが終わりました"));

  root.replaceChildren(
    el("h2", { id: "h-nsdr", text: "NSDR / ボディスキャン" }),
    el("p", { class: "lede", text: "横になったまま、案内に沿って注意を移していきます。眠ってしまっても構いません。" }),
    el("div", { class: "card" }, [
      line,
      progress,
      el("div", { class: "row", style: "margin:12px 0 14px" }, [noteText, clock]),
      startBtn,
    ]),
    el("div", { class: "card" }, [
      el("h3", { text: "長さ" }),
      sessionChips,
    ]),
    el("div", { class: "card" }, [
      el("div", { class: "row" }, [
        el("span", { class: "muted", text: speechSupported ? "端末の音声合成で読み上げます" : "この端末は音声合成に対応していません" }),
        voiceToggle,
      ]),
      el("p", { class: "muted", style: "margin-top:12px" },
        ["他の画面へ移っても続きます。呼吸ガイドと重ねる場合、読み上げ中は合図音が自動で控えめになります。"]),
    ]),
  );

  nsdrSession.bind(paint);
  return () => nsdrSession.unbind(paint);
}
