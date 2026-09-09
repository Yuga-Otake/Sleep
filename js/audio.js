/**
 * Web Audio によるサウンド生成エンジン。
 *
 * 音源ファイルを一切持たず、すべてブラウザ上で合成する。そのためリポジトリは
 * 数十 KB のまま、GitHub Pages にそのまま置ける。信号経路は
 *
 *   各レイヤー → layerGain → busGain(スリープタイマーのフェード)
 *                            → breathGain(呼吸に合わせた揺らぎ) → masterGain → 出力
 *
 * で、呼吸ガイドの合図音だけは busGain と breathGain を迂回して masterGain に
 * 直結する (サウンドのフェードアウトや揺らぎの谷で合図が消えないようにするため)。
 */

import { clamp } from "./util.js";
import { cycleLength, fullnessAt } from "./breath-math.js";

const FLOOR = 0.0001;   // exponentialRamp に 0 は渡せないので使う下限値
const FADE_SEC = 60;    // スリープタイマー終了前のフェードアウト長
const DUCK = 0.3;       // ナレーション中に合図音へかける倍率

let ctx = null;
let masterGain = null;
let busGain = null;
let breathGain = null;
let masterVolume = 0.7;

const buffers = new Map();
const layers = new Map();

/** ユーザー操作の中から呼ぶこと。iOS/Chrome の自動再生制限を解除する。 */
export function ensureContext() {
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    masterGain = ctx.createGain();
    masterGain.gain.value = masterVolume;
    masterGain.connect(ctx.destination);
    breathGain = ctx.createGain();
    breathGain.gain.value = 1;
    breathGain.connect(masterGain);
    busGain = ctx.createGain();
    busGain.gain.value = 1;
    busGain.connect(breathGain);
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

export function isSupported() {
  return Boolean(window.AudioContext || window.webkitAudioContext);
}

export function getMasterVolume() {
  return masterVolume;
}

export function setMasterVolume(value) {
  masterVolume = clamp(value, 0, 1);
  if (masterGain) {
    masterGain.gain.setTargetAtTime(masterVolume, ctx.currentTime, 0.02);
  }
}

/* ---------- ノイズ生成 ---------- */

/**
 * ループ用のノイズバッファを作る。長さ 6 秒は、ループの継ぎ目が
 * 周期として耳につかない程度に長く、生成コストが無視できる程度に短い。
 */
function noiseBuffer(kind) {
  const cached = buffers.get(kind);
  if (cached) return cached;

  const length = ctx.sampleRate * 6;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  if (kind === "white") {
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  } else if (kind === "pink") {
    // Paul Kellet のフィルタ近似。1/f 特性を -3dB/oct で得る。
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else {
    // ブラウン: ホワイトノイズを積分する。発散を防ぐため係数で減衰させる。
    let last = 0;
    for (let i = 0; i < length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      data[i] = last * 3.5;
    }
  }

  buffers.set(kind, buffer);
  return buffer;
}

function noiseSource(kind) {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(kind);
  source.loop = true;
  return source;
}

/* ---------- レイヤー定義 ---------- */

/**
 * 各レイヤーは create(out) で音を鳴らし始め、返り値の stop() で完全に停止する。
 * setOption は可変パラメータを持つレイヤー (バイノーラル) だけが実装する。
 */
export const LAYER_SPECS = {
  white: {
    label: "ホワイトノイズ",
    desc: "全帯域が均一。物音のマスキングに最も強い",
    defaultVolume: 0.35,
    create(out) {
      const src = noiseSource("white");
      src.connect(out);
      src.start();
      return { stop: () => src.stop() };
    },
  },

  pink: {
    label: "ピンクノイズ",
    desc: "低音寄りで耳当たりが柔らかい。就寝時の定番",
    defaultVolume: 0.45,
    create(out) {
      const src = noiseSource("pink");
      src.connect(out);
      src.start();
      return { stop: () => src.stop() };
    },
  },

  brown: {
    label: "ブラウンノイズ",
    desc: "さらに低音寄り。遠くの滝のような響き",
    defaultVolume: 0.5,
    create(out) {
      const src = noiseSource("brown");
      const shelf = ctx.createBiquadFilter();
      shelf.type = "lowpass";
      shelf.frequency.value = 1200;
      src.connect(shelf).connect(out);
      src.start();
      return { stop: () => src.stop() };
    },
  },

  waves: {
    label: "波（ゆらぎ）",
    desc: "約12秒周期で寄せては返す。呼吸を遅くする手がかりになる",
    defaultVolume: 0.5,
    create(out) {
      const src = noiseSource("brown");
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 620;
      filter.Q.value = 0.4;

      const swell = ctx.createGain();
      swell.gain.value = 0.45;

      // 12 秒周期の LFO を音量とカットオフの両方に流し、寄せ波の輪郭を作る。
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 1 / 12;

      const toGain = ctx.createGain();
      toGain.gain.value = 0.4;
      const toCutoff = ctx.createGain();
      toCutoff.gain.value = 380;

      lfo.connect(toGain).connect(swell.gain);
      lfo.connect(toCutoff).connect(filter.frequency);

      src.connect(filter).connect(swell).connect(out);
      src.start();
      lfo.start();
      return { stop: () => { src.stop(); lfo.stop(); } };
    },
  },

  rain: {
    label: "雨音",
    desc: "細かい高域と低い雨だれの二層構成",
    defaultVolume: 0.4,
    create(out) {
      const hiss = noiseSource("white");
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 900;
      const shape = ctx.createBiquadFilter();
      shape.type = "peaking";
      shape.frequency.value = 3200;
      shape.gain.value = 5;
      shape.Q.value = 0.7;
      const hissGain = ctx.createGain();
      hissGain.gain.value = 0.55;
      hiss.connect(hp).connect(shape).connect(hissGain).connect(out);

      const rumble = noiseSource("brown");
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 320;
      const rumbleGain = ctx.createGain();
      rumbleGain.gain.value = 0.35;
      rumble.connect(lp).connect(rumbleGain).connect(out);

      hiss.start();
      rumble.start();
      return { stop: () => { hiss.stop(); rumble.stop(); } };
    },
  },

  binaural: {
    label: "バイノーラルビート",
    desc: "左右にわずかに違う純音。ヘッドホン必須",
    defaultVolume: 0.22,
    options: { carrier: 200, beat: 3 },
    create(out, options) {
      const make = (pan) => {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        const panner = ctx.createStereoPanner
          ? ctx.createStereoPanner()
          : null;
        const gain = ctx.createGain();
        gain.gain.value = 0.5;
        if (panner) {
          panner.pan.value = pan;
          osc.connect(gain).connect(panner).connect(out);
        } else {
          // StereoPanner 非対応環境では左右分離を諦め、単なる二音として鳴らす。
          osc.connect(gain).connect(out);
        }
        osc.start();
        return osc;
      };

      const left = make(-1);
      const right = make(1);

      const apply = ({ carrier, beat }) => {
        const now = ctx.currentTime;
        left.frequency.setTargetAtTime(carrier - beat / 2, now, 0.05);
        right.frequency.setTargetAtTime(carrier + beat / 2, now, 0.05);
      };
      apply(options);

      return {
        stop: () => { left.stop(); right.stop(); },
        setOption: (_key, _value, all) => apply(all),
      };
    },
  },
};

class Layer {
  constructor(id, spec) {
    this.id = id;
    this.spec = spec;
    this.volume = spec.defaultVolume;
    this.options = { ...(spec.options || {}) };
    this.playing = false;
    this.gain = null;
    this.handle = null;
  }

  start() {
    if (this.playing || !ensureContext()) return;
    this.gain = ctx.createGain();
    this.gain.gain.value = FLOOR;
    this.gain.connect(busGain);
    this.handle = this.spec.create(this.gain, this.options);
    // 立ち上がりの 0.8 秒フェードイン。突然の音圧は覚醒方向に働くため。
    this.gain.gain.exponentialRampToValueAtTime(Math.max(this.volume, FLOOR), ctx.currentTime + 0.8);
    this.playing = true;
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    const handle = this.handle;
    const gain = this.gain;
    this.handle = null;
    this.gain = null;
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(Math.max(gain.gain.value, FLOOR), ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(FLOOR, ctx.currentTime + 0.5);
    setTimeout(() => {
      try { handle.stop(); } catch { /* 既に停止済み */ }
      gain.disconnect();
    }, 620);
  }

  setVolume(value) {
    this.volume = clamp(value, 0, 1);
    if (this.gain) {
      this.gain.gain.setTargetAtTime(Math.max(this.volume, FLOOR), ctx.currentTime, 0.05);
    }
  }

  setOption(key, value) {
    this.options[key] = value;
    this.handle?.setOption?.(key, value, this.options);
  }
}

export function getLayer(id) {
  if (!layers.has(id)) {
    const spec = LAYER_SPECS[id];
    if (!spec) throw new Error(`unknown layer: ${id}`);
    layers.set(id, new Layer(id, spec));
  }
  return layers.get(id);
}

export function anyPlaying() {
  return [...layers.values()].some((layer) => layer.playing);
}

export function stopAllLayers() {
  for (const layer of layers.values()) layer.stop();
  cancelSleepTimer();
  stopBreathModulation();
}

/* ---------- スリープタイマー ---------- */

let timerEndsAt = 0;
let timerTimeout = 0;
let timerOnEnd = null;

/** 残り秒数。動作していなければ 0。 */
export function sleepTimerRemaining() {
  if (!timerEndsAt) return 0;
  return Math.max(0, Math.round((timerEndsAt - Date.now()) / 1000));
}

export function startSleepTimer(minutes, onEnd) {
  if (!ensureContext()) return;
  cancelSleepTimer();

  const totalSec = minutes * 60;
  const fade = Math.min(FADE_SEC, totalSec * 0.4);
  const now = ctx.currentTime;

  busGain.gain.cancelScheduledValues(now);
  busGain.gain.setValueAtTime(1, now);
  busGain.gain.setValueAtTime(1, now + totalSec - fade);
  busGain.gain.exponentialRampToValueAtTime(FLOOR, now + totalSec);

  timerEndsAt = Date.now() + totalSec * 1000;
  timerOnEnd = onEnd;
  timerTimeout = setTimeout(() => {
    for (const layer of layers.values()) layer.stop();
    resetBus();
    timerEndsAt = 0;
    timerOnEnd = null;
    onEnd?.();
  }, totalSec * 1000 + 400);
}

export function cancelSleepTimer() {
  if (timerTimeout) clearTimeout(timerTimeout);
  timerTimeout = 0;
  timerEndsAt = 0;
  timerOnEnd = null;
  resetBus();
}

function resetBus() {
  if (!busGain) return;
  busGain.gain.cancelScheduledValues(ctx.currentTime);
  busGain.gain.setValueAtTime(1, ctx.currentTime);
}

/* ---------- 呼吸に合わせた揺らぎ ---------- */

/**
 * 呼吸の波形を、そのままサウンドの音量に流し込む。吸うと音が満ち、吐くと引く。
 *
 * 毎フレーム JS から音量を書き換える作りにはしていない。requestAnimationFrame は
 * ブラウザを背面に回すと止まるため、画面を見ていない間に音量が中途半端な値で
 * 固まってしまう。そこで 1 呼吸ぶんの包絡を AudioBuffer に書き出してループ再生し、
 * その信号を AudioParam に加算する。以降は音声スレッドだけで正確に回り続ける。
 *
 * breathGain.gain の内在値を (1 - depth) に置き、そこへ 0〜depth の信号を足すので、
 * 実際の倍率は (1 - depth) 〜 1 の範囲を往復する。depth を 1 未満に保つ限り、
 * 谷でも無音にはならない。
 */

const ENV_RATE = 8000;   // 包絡はゆっくり動くので音声レートは要らない

let breathSource = null;
let breathDepthGain = null;
let breathDepth = 0.6;
let breathPhases = null;

function envelopeBuffer(phases) {
  const cycle = cycleLength(phases);
  const length = Math.max(1, Math.round(ENV_RATE * cycle));
  const buffer = ctx.createBuffer(1, length, ENV_RATE);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = fullnessAt(phases, i / ENV_RATE);
  return buffer;
}

function teardownBreathSource() {
  if (!breathSource) return;
  try { breathSource.stop(); } catch { /* 既に停止済み */ }
  breathSource.disconnect();
  breathDepthGain.disconnect();
  breathSource = null;
  breathDepthGain = null;
}

/**
 * 揺らぎを始める。
 * @param {object[]} phases    呼吸パターンのフェーズ列
 * @param {number} offsetSec  呼吸のどこから始めるか（進行中のセッションに合わせる用）
 */
export function startBreathModulation(phases, offsetSec = 0) {
  if (!ensureContext() || !phases?.length) return;
  teardownBreathSource();
  breathPhases = phases;

  const cycle = cycleLength(phases);
  breathSource = ctx.createBufferSource();
  breathSource.buffer = envelopeBuffer(phases);
  breathSource.loop = true;

  breathDepthGain = ctx.createGain();
  breathDepthGain.gain.value = breathDepth;
  breathSource.connect(breathDepthGain).connect(breathGain.gain);

  breathGain.gain.cancelScheduledValues(ctx.currentTime);
  breathGain.gain.value = 1 - breathDepth;

  const offset = ((offsetSec % cycle) + cycle) % cycle;
  breathSource.start(ctx.currentTime, offset);
}

export function stopBreathModulation() {
  if (!ctx || !breathSource) {
    breathPhases = null;
    return;
  }
  teardownBreathSource();
  breathPhases = null;
  // 信号が切れたので、内在値を 1 へ戻せばそのまま等倍に復帰する。
  breathGain.gain.setTargetAtTime(1, ctx.currentTime, 0.25);
}

export function isBreathModulationOn() {
  return Boolean(breathSource);
}

export function getBreathDepth() {
  return breathDepth;
}

export function setBreathDepth(value) {
  breathDepth = clamp(value, 0, 0.95);
  if (!breathSource) return;
  const now = ctx.currentTime;
  breathDepthGain.gain.setTargetAtTime(breathDepth, now, 0.05);
  breathGain.gain.setTargetAtTime(1 - breathDepth, now, 0.05);
}

/**
 * パターンが変わったとき、または呼吸セッションが始まったときに位相を貼り直す。
 * 揺らぎが止まっているときは何もしない。
 */
export function retuneBreathModulation(phases, offsetSec = 0) {
  if (!breathSource) return;
  startBreathModulation(phases, offsetSec);
}

/* ---------- 合図音 ---------- */

let narrationActive = false;

/**
 * NSDR のナレーションが喋っているかどうかを伝える。喋っている間は合図音を
 * 控えめにして、言葉が埋もれないようにする（呼吸ガイドとの併走時に効く）。
 */
export function setNarrationActive(active) {
  narrationActive = Boolean(active);
}

/**
 * 合図音の倍音構成。
 *
 * 当初は基音だけの正弦波だったが、264Hz のような低い音はスマートフォンの
 * 内蔵スピーカーではほとんど再生されない（実測でエネルギーの約7割が
 * 300Hz 未満に集中していた）。倍音を重ねて、小さなスピーカーが再生できる
 * 帯域にも成分を持たせている。上の倍音ほど短く減衰させることで、
 * ビープ音ではなく柔らかい鐘の響きになる。
 */
const PARTIALS = [
  { ratio: 1, gain: 1, decay: 1 },      // 基音: ヘッドホンでの温かさを担う
  { ratio: 2, gain: 0.45, decay: 0.7 },
  { ratio: 4, gain: 0.18, decay: 0.45 }, // 小さなスピーカーでも届く帯域
];

/**
 * 呼吸フェーズの切り替わりを知らせる短い音。減衰のみで立ち上がりを持たせ、
 * クリックノイズが出ないようにしている。
 */
export function chime({ frequency = 396, duration = 0.9, volume = 0.18 } = {}) {
  if (!ensureContext()) return;
  const level = Math.max(FLOOR, volume * (narrationActive ? DUCK : 1));
  const now = ctx.currentTime;

  for (const partial of PARTIALS) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency * partial.ratio;

    const peak = Math.max(FLOOR, level * partial.gain);
    const end = duration * partial.decay;

    gain.gain.setValueAtTime(FLOOR, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(FLOOR, now + end);

    osc.connect(gain).connect(masterGain);
    osc.start(now);
    osc.stop(now + end + 0.05);
  }
}
