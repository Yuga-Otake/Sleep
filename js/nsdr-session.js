/**
 * NSDR / ボディスキャンのセッション。
 *
 * 呼吸ガイドと同じく、表示から切り離して時間と読み上げをここで管理する。
 * 画面を離れてもナレーションは続く。読み上げ中は audio 側に合図音を控えるよう
 * 伝え、呼吸ガイドと併走しても言葉が埋もれないようにしている。
 */

import { createWakeLock } from "./util.js";
import { setNarrationActive } from "./audio.js";
import { load, save } from "./store.js";

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
const TAIL_SILENCE = 30;   // 最後の一文を読み終えてから終了までの余白（秒）

const prefs = load(PREF_KEY, { session: "short", voice: true });
if (!SESSIONS[prefs.session]) prefs.session = "short";

export const speechSupported = "speechSynthesis" in window;

const wakeLock = createWakeLock();

let state = "idle";     // idle | running | done
let startedAt = 0;
let timer = 0;
let cueIndex = -1;
let listener = null;
let onFinish = null;

const current = () => SESSIONS[prefs.session];

function totalSeconds() {
  const cues = current().cues;
  return cues[cues.length - 1].at + TAIL_SILENCE;
}

function elapsed() {
  return state === "running" ? (Date.now() - startedAt) / 1000 : 0;
}

function speak(text) {
  if (!prefs.voice || !speechSupported) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ja-JP";
  utterance.rate = 0.82;   // 誘導としては通常より遅い方が合う
  utterance.pitch = 0.95;
  utterance.volume = 0.9;
  const jaVoice = speechSynthesis.getVoices().find((v) => v.lang?.startsWith("ja"));
  if (jaVoice) utterance.voice = jaVoice;

  // 喋っている間だけ、呼吸ガイドの合図音を控えさせる。
  utterance.onstart = () => setNarrationActive(true);
  utterance.onend = () => setNarrationActive(false);
  utterance.onerror = () => setNarrationActive(false);

  speechSynthesis.speak(utterance);
}

function snapshot() {
  const time = elapsed();
  const cues = current().cues;
  return {
    state,
    elapsed: time,
    total: totalSeconds(),
    line: state === "idle" ? null : (cues[Math.max(0, cueIndex)]?.text ?? null),
    session: current(),
  };
}

function emit() {
  listener?.(snapshot());
}

function tick() {
  if (state !== "running") return;
  const time = elapsed();

  const cues = current().cues;
  let next = cueIndex;
  while (next + 1 < cues.length && cues[next + 1].at <= time) next += 1;
  if (next !== cueIndex) {
    cueIndex = next;
    speak(cues[cueIndex].text);
  }

  emit();
  if (time >= totalSeconds()) finish();
}

function halt(nextState) {
  state = nextState;
  clearInterval(timer);
  timer = 0;
  if (speechSupported) speechSynthesis.cancel();
  setNarrationActive(false);
  wakeLock.release();
}

function finish() {
  halt("done");
  emit();
  onFinish?.();
}

export const nsdrSession = {
  prefs,
  SESSIONS,

  get running() { return state === "running"; },
  get state() { return state; },

  current,
  totalSeconds,

  savePrefs() { save(PREF_KEY, prefs); },

  setSession(id) {
    if (!SESSIONS[id]) return;
    if (state === "running") this.stop();
    prefs.session = id;
    this.savePrefs();
    cueIndex = -1;
    emit();
  },

  setVoice(enabled) {
    prefs.voice = enabled;
    this.savePrefs();
    if (!enabled && speechSupported) {
      speechSynthesis.cancel();
      setNarrationActive(false);
    }
  },

  start() {
    state = "running";
    startedAt = Date.now();
    cueIndex = -1;
    wakeLock.acquire();
    tick();
    timer = setInterval(tick, 500);
  },

  stop() {
    halt("idle");
    cueIndex = -1;
    emit();
  },

  toggle() {
    if (state === "running") this.stop(); else this.start();
  },

  setFinishHandler(fn) { onFinish = fn; },

  bind(fn) {
    listener = fn;
    emit();
  },

  unbind(fn) {
    if (listener === fn) listener = null;
  },

  snapshot,
};
