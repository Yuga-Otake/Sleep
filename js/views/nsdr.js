/**
 * NSDR / ボディスキャン。
 *
 * 台本は「読み上げ開始時刻(秒) + 文」の並びで持ち、経過時間に応じて表示を
 * 差し替える。読み上げは Web Speech API を使うが、未対応でも文字だけで
 * 完結するように作ってある。
 */

import { el, formatClock, toast, createWakeLock } from "../util.js";
import { load, save } from "../store.js";

/** @typedef {{at:number, text:string}} Cue */

/** 秒数と文の組から、開始時刻を積み上げた台本を作る。 */
function script(steps) {
  let at = 0;
  return steps.map(([hold, text]) => {
    const cue = { at, text };
    at += hold;
    return cue;
  });
}

const SESSIONS = {
  short: {
    label: "10分 ボディスキャン",
    note: "昼間の立て直しに。眠り込まずに深く休みたいとき。",
    cues: script([
      [24, "仰向けか、楽な姿勢で横になります。目は閉じても、半分開いたままでも構いません。"],
      [30, "まず、床や布団に触れている部分に気づきます。かかと、ふくらはぎ、背中、後頭部。"],
      [34, "息を長く、細く吐きます。吐き切るところまで。吸うのは自然に任せます。"],
      [34, "もう一度。吐く息のほうを、吸う息より長く。"],
      [40, "注意を左足の裏へ移します。足の裏の温度、湿り気、重さ。"],
      [40, "左のふくらはぎ、太もも。重さがそのまま床に預けられていきます。"],
      [40, "同じように右足の裏へ。右のふくらはぎ、太もも。"],
      [40, "骨盤、腰、背中。支えている力を、少しずつ手放します。"],
      [40, "両手の指先へ。手のひら、前腕、肘、二の腕。"],
      [40, "肩を下げます。首の後ろ、あご、こめかみ、目のまわり、額。"],
      [45, "体全体を、ひとつのまとまりとして感じます。輪郭がぼやけていっても構いません。"],
      [45, "呼吸はもう数えません。ただ、出入りしているのを眺めます。"],
      [40, "そろそろ終わりに近づきます。指先を少し動かします。"],
      [30, "深く息を吸って、ゆっくり吐きます。自分のペースで目を開けてください。"],
    ]),
  },
  long: {
    label: "20分 ヨガニドラ風",
    note: "就寝前に。そのまま眠ってしまっても問題ありません。",
    cues: script([
      [30, "横になり、体の重さを床に預けます。これから20分、何もしなくて構いません。"],
      [40, "眠ってしまっても大丈夫です。ここでは、眠らないことも目的ではありません。"],
      [45, "息を長く吐きます。吐き切って、次の息が自然に入ってくるのを待ちます。"],
      [45, "あと二回、同じように。吐く時間を、吸う時間の倍くらいに。"],
      [50, "右手の親指に注意を向けます。人差し指、中指、薬指、小指。"],
      [50, "右の手のひら、手首、前腕、肘、二の腕、肩。"],
      [50, "左手の親指、人差し指、中指、薬指、小指。"],
      [50, "左の手のひら、手首、前腕、肘、二の腕、肩。"],
      [50, "右足の親指から小指へ。足の裏、かかと、足首。"],
      [50, "右のふくらはぎ、膝、太もも、股関節。"],
      [50, "左足の親指から小指へ。足の裏、かかと、足首。"],
      [50, "左のふくらはぎ、膝、太もも、股関節。"],
      [50, "お腹、胸。呼吸に合わせて、静かに上下しています。"],
      [50, "背中全体。肩甲骨のあいだ、腰。床に沈んでいきます。"],
      [50, "喉、あご、舌の力を抜きます。歯を噛みしめていたら、離します。"],
      [50, "頬、目のまわり、眉のあいだ、額、頭皮。"],
      [60, "体全体をひとつとして感じます。境目がわからなくなっても構いません。"],
      [60, "重さ。全身が重く、床に沈んでいく感覚。"],
      [60, "温かさ。手のひらと足の裏が、少しずつ温かくなっていきます。"],
      [60, "ここからは何も追いません。ただ、呼吸が続いているのを感じています。"],
      [60, "静かなまま、しばらく留まります。"],
      [40, "このまま眠る場合は、ここで終わりにしてください。"],
      [30, "戻る場合は、指先を少し動かし、深く息を吸って、ゆっくり目を開けます。"],
    ]),
  },
};

const PREF_KEY = "nsdr-prefs";

export function render(root) {
  const prefs = load(PREF_KEY, { session: "short", voice: true });
  if (!SESSIONS[prefs.session]) prefs.session = "short";

  const speechSupported = "speechSynthesis" in window;
  const wakeLock = createWakeLock();

  const line = el("div", { class: "session-script", "aria-live": "polite" },
    ["静かな場所で横になれる状態にしてから始めてください。"]);
  const bar = el("i");
  const progress = el("div", { class: "progress" }, [bar]);
  const clock = el("span", { class: "timer-state", text: "0:00" });
  const startBtn = el("button", { class: "btn btn-primary btn-block", type: "button", text: "開始" });
  const sessionChips = el("div", { class: "chips", role: "group", "aria-label": "セッションの長さ" });

  const voiceToggle = el("button", {
    class: "chip", type: "button", role: "switch",
    "aria-checked": String(prefs.voice && speechSupported),
    disabled: !speechSupported,
    text: speechSupported ? "音声で読み上げ" : "読み上げ非対応",
  });

  let timer = 0;
  let startedAt = 0;
  let cueIndex = -1;
  let running = false;

  const current = () => SESSIONS[prefs.session];
  const totalSeconds = () => {
    const cues = current().cues;
    return cues[cues.length - 1].at + 30;
  };

  function speak(text) {
    if (!prefs.voice || !speechSupported) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ja-JP";
    utterance.rate = 0.82;   // 誘導としては通常より遅い方が合う
    utterance.pitch = 0.95;
    utterance.volume = 0.9;
    const jaVoice = speechSynthesis.getVoices().find((v) => v.lang?.startsWith("ja"));
    if (jaVoice) utterance.voice = jaVoice;
    speechSynthesis.speak(utterance);
  }

  function tick() {
    const elapsed = (Date.now() - startedAt) / 1000;
    const total = totalSeconds();
    clock.textContent = `${formatClock(elapsed)} / ${formatClock(total)}`;
    bar.style.width = `${Math.min(100, (elapsed / total) * 100)}%`;

    const cues = current().cues;
    let next = cueIndex;
    while (next + 1 < cues.length && cues[next + 1].at <= elapsed) next += 1;
    if (next !== cueIndex) {
      cueIndex = next;
      line.textContent = cues[cueIndex].text;
      speak(cues[cueIndex].text);
    }

    if (elapsed >= total) finish();
  }

  function start() {
    running = true;
    startedAt = Date.now();
    cueIndex = -1;
    startBtn.textContent = "終了";
    startBtn.classList.remove("btn-primary");
    wakeLock.acquire();
    tick();
    timer = setInterval(tick, 500);
  }

  function stop() {
    running = false;
    clearInterval(timer);
    timer = 0;
    if (speechSupported) speechSynthesis.cancel();
    wakeLock.release();
    startBtn.textContent = "開始";
    startBtn.classList.add("btn-primary");
  }

  function finish() {
    stop();
    bar.style.width = "100%";
    line.textContent = "おつかれさま。";
    toast("セッション終了");
  }

  function paintSessions() {
    sessionChips.replaceChildren();
    for (const [id, spec] of Object.entries(SESSIONS)) {
      sessionChips.append(el("button", {
        class: "chip", type: "button", "aria-pressed": String(id === prefs.session),
        onclick: () => {
          if (running) stop();
          prefs.session = id;
          save(PREF_KEY, prefs);
          paintSessions();
          line.textContent = spec.note;
          bar.style.width = "0%";
          clock.textContent = `0:00 / ${formatClock(totalSeconds())}`;
        },
      }, [spec.label]));
    }
  }

  startBtn.addEventListener("click", () => (running ? stop() : start()));
  voiceToggle.addEventListener("click", () => {
    prefs.voice = !prefs.voice;
    voiceToggle.setAttribute("aria-checked", String(prefs.voice));
    save(PREF_KEY, prefs);
    if (!prefs.voice && speechSupported) speechSynthesis.cancel();
  });

  paintSessions();
  clock.textContent = `0:00 / ${formatClock(totalSeconds())}`;

  root.replaceChildren(
    el("h2", { id: "h-nsdr", text: "NSDR / ボディスキャン" }),
    el("p", { class: "lede", text: "横になったまま、案内に沿って注意を移していきます。眠ってしまっても構いません。" }),
    el("div", { class: "card" }, [
      line,
      progress,
      el("div", { class: "row", style: "margin:12px 0 14px" }, [
        el("span", { class: "muted", text: current().note }),
        clock,
      ]),
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
    ]),
  );

  return () => { stop(); };
}
