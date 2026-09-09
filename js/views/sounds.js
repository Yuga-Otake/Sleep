/** 睡眠サウンド。合成音のレイヤーを重ね、スリープタイマーでフェードアウトさせる。 */

import { el, formatClock, toast, isIOS } from "../util.js";
import {
  LAYER_SPECS, getLayer, ensureContext, isSupported,
  getMasterVolume, setMasterVolume, stopAllLayers,
  startSleepTimer, cancelSleepTimer, sleepTimerRemaining,
  startBreathModulation, stopBreathModulation, isBreathModulationOn,
  getBreathDepth, setBreathDepth,
} from "../audio.js";
import { breathSession } from "../breath-session.js";
import { load, save } from "../store.js";

const PREF_KEY = "sound-prefs";
const TIMER_CHOICES = [15, 30, 45, 60, 90];

/** よく使う組み合わせ。押すとレイヤーの on/off と音量を一括で設定する。 */
const PRESETS = {
  mask: { label: "生活音を消す", layers: { pink: 0.5 } },
  rainy: { label: "雨の夜", layers: { rain: 0.42, brown: 0.28 } },
  shore: { label: "波打ち際", layers: { waves: 0.55 } },
  deep: { label: "低い唸り", layers: { brown: 0.5, binaural: 0.2 } },
};

export function render(root) {
  const prefs = load(PREF_KEY, { volume: getMasterVolume(), timer: 30, layers: {}, breathDepth: 0.6 });
  setMasterVolume(prefs.volume ?? 0.7);
  setBreathDepth(prefs.breathDepth ?? 0.6);

  if (!isSupported()) {
    root.replaceChildren(
      el("h2", { id: "h-sounds", text: "サウンド" }),
      el("p", { class: "empty", text: "このブラウザは Web Audio に対応していないため、サウンドを生成できません。" }),
    );
    return () => {};
  }

  const timerLabel = el("span", { class: "timer-state", text: "オフ" });
  const timerChips = el("div", { class: "chips", role: "group", "aria-label": "スリープタイマー" });
  const mixer = el("div", { class: "mixer" });
  const presetChips = el("div", { class: "chips", role: "group", "aria-label": "プリセット" });

  const controls = new Map();   // レイヤーID → 表示更新用の要素

  function persist() {
    prefs.breathDepth = getBreathDepth();
    prefs.layers = {};
    for (const id of Object.keys(LAYER_SPECS)) {
      const layer = getLayer(id);
      prefs.layers[id] = { on: layer.playing, volume: layer.volume, options: { ...layer.options } };
    }
    save(PREF_KEY, prefs);
  }

  function setLayerOn(id, on) {
    const layer = getLayer(id);
    if (on) { ensureContext(); layer.start(); } else layer.stop();
    const ui = controls.get(id);
    ui.wrap.dataset.on = String(on);
    ui.toggle.setAttribute("aria-checked", String(on));
    persist();
  }

  function buildLayer(id, spec) {
    const saved = prefs.layers?.[id];
    const layer = getLayer(id);
    if (saved) {
      layer.setVolume(saved.volume ?? spec.defaultVolume);
      for (const [k, v] of Object.entries(saved.options || {})) layer.options[k] = v;
    }

    const toggle = el("button", {
      class: "switch", type: "button", role: "switch",
      "aria-checked": "false", "aria-label": `${spec.label} を再生`,
      onclick: () => setLayerOn(id, !getLayer(id).playing),
    });

    const volume = el("input", {
      type: "range", min: "0", max: "1", step: "0.01", value: String(layer.volume),
      "aria-label": `${spec.label} の音量`,
      oninput: (e) => { layer.setVolume(Number(e.target.value)); },
      onchange: persist,
    });

    const body = el("div", { class: "layer-body" }, [volume]);

    // バイノーラルだけは周波数を触れるようにする。
    if (id === "binaural") {
      const beatValue = el("span", { class: "timer-state", text: `${layer.options.beat} Hz` });
      const beat = el("input", {
        type: "range", min: "0.5", max: "8", step: "0.5", value: String(layer.options.beat),
        "aria-label": "うなりの周波数",
        oninput: (e) => {
          const hz = Number(e.target.value);
          beatValue.textContent = `${hz} Hz`;
          layer.setOption("beat", hz);
        },
        onchange: persist,
      });
      body.append(
        el("div", { class: "row", style: "margin-top:10px" }, [
          el("label", { for: "", text: "うなりの周波数", style: "margin:0" }),
          beatValue,
        ]),
        beat,
        el("p", { class: "muted", text: "左右の耳に別々の音が届く必要があります。スピーカーでは効果が出ません。" }),
      );
    }

    const wrap = el("div", { class: "layer", "data-on": "false" }, [
      el("div", { class: "layer-head" }, [
        el("div", {}, [
          el("div", { class: "layer-name", text: spec.label }),
          el("div", { class: "layer-desc", text: spec.desc }),
        ]),
        toggle,
      ]),
      body,
    ]);

    controls.set(id, { wrap, toggle, volume });
    return wrap;
  }

  for (const [id, spec] of Object.entries(LAYER_SPECS)) mixer.append(buildLayer(id, spec));

  for (const [key, preset] of Object.entries(PRESETS)) {
    presetChips.append(el("button", {
      class: "chip", type: "button",
      onclick: () => {
        ensureContext();
        for (const id of Object.keys(LAYER_SPECS)) {
          const wanted = preset.layers[id];
          const layer = getLayer(id);
          if (wanted != null) {
            layer.setVolume(wanted);
            controls.get(id).volume.value = String(wanted);
            if (!layer.playing) setLayerOn(id, true);
          } else if (layer.playing) {
            setLayerOn(id, false);
          }
        }
        persist();
        toast(`${preset.label} を再生中`);
      },
    }, [preset.label]));
  }

  /* ---------- スリープタイマー ---------- */

  let activeTimer = 0;

  function paintTimerChips() {
    timerChips.replaceChildren();
    for (const minutes of TIMER_CHOICES) {
      timerChips.append(el("button", {
        class: "chip", type: "button", "aria-pressed": String(activeTimer === minutes),
        onclick: () => {
          activeTimer = activeTimer === minutes ? 0 : minutes;
          if (activeTimer) {
            startSleepTimer(activeTimer, () => {
              activeTimer = 0;
              for (const id of Object.keys(LAYER_SPECS)) {
                const ui = controls.get(id);
                ui.wrap.dataset.on = "false";
                ui.toggle.setAttribute("aria-checked", "false");
              }
              paintTimerChips();
              toast("タイマーで停止しました");
            });
            toast(`${activeTimer}分後に停止します`);
          } else {
            cancelSleepTimer();
          }
          paintTimerChips();
        },
      }, [`${minutes}分`]));
    }
  }

  const countdown = setInterval(() => {
    const remaining = sleepTimerRemaining();
    timerLabel.textContent = remaining ? formatClock(remaining) : "オフ";
  }, 1000);

  const masterSlider = el("input", {
    type: "range", min: "0", max: "1", step: "0.01", value: String(getMasterVolume()),
    "aria-label": "全体の音量",
    oninput: (e) => setMasterVolume(Number(e.target.value)),
    onchange: () => { prefs.volume = getMasterVolume(); save(PREF_KEY, prefs); },
  });

  /* ---------- 呼吸に合わせた揺らぎ ---------- */

  const swayPattern = el("span", { class: "muted" });

  const swayToggle = el("button", {
    class: "switch", type: "button", role: "switch",
    "aria-checked": String(isBreathModulationOn()),
    "aria-label": "呼吸に合わせて音を揺らす",
    onclick: () => {
      if (isBreathModulationOn()) {
        stopBreathModulation();
      } else {
        ensureContext();
        // 呼吸セッションが動いていれば、その途中の位相から合わせる。
        const elapsed = breathSession.running ? breathSession.snapshot().elapsed : 0;
        startBreathModulation(breathSession.pattern().phases, elapsed);
      }
      paintSway();
      persist();
    },
  });

  const swayDepth = el("input", {
    type: "range", min: "0.15", max: "0.9", step: "0.05", value: String(getBreathDepth()),
    "aria-label": "揺らぎの深さ",
    oninput: (e) => setBreathDepth(Number(e.target.value)),
    onchange: () => { prefs.breathDepth = getBreathDepth(); save(PREF_KEY, prefs); },
  });

  const swayBody = el("div", { class: "layer-body" }, [
    swayDepth,
    el("p", { class: "muted", style: "margin-top:2px" },
      ["深くすると満ち引きがはっきりします。谷でも無音にはなりません。"]),
  ]);

  const swayWrap = el("div", { class: "layer", "data-on": "false" }, [
    el("div", { class: "layer-head" }, [
      el("div", {}, [
        el("div", { class: "layer-name", text: "呼吸に合わせて揺らす" }),
        el("div", { class: "layer-desc" }, [
          "吸うと音が満ち、吐くと引く。目を閉じたまま呼吸を合わせられます",
        ]),
      ]),
      swayToggle,
    ]),
    swayBody,
  ]);

  function paintSway() {
    const on = isBreathModulationOn();
    swayWrap.dataset.on = String(on);
    swayToggle.setAttribute("aria-checked", String(on));
    const spec = breathSession.pattern();
    swayPattern.textContent = `いまのパターン: ${spec.label}（${spec.tagline}）・呼吸画面で変更できます`;
  }

  paintSway();
  paintTimerChips();

  root.replaceChildren(
    el("h2", { id: "h-sounds", text: "サウンド" }),
    el("p", { class: "lede", text: "すべてブラウザ内で合成しています。音源のダウンロードも通信も発生しません。" }),
    el("div", { class: "card" }, [
      el("h3", { text: "プリセット" }),
      presetChips,
    ]),
    el("div", { class: "card" }, [
      el("h3", { text: "ミキサー" }),
      mixer,
    ]),
    el("div", { class: "card" }, [
      swayWrap,
      el("p", { class: "muted", style: "margin-top:12px" }, [swayPattern]),
    ]),
    el("div", { class: "card" }, [
      el("div", { class: "row" }, [
        el("h3", { text: "スリープタイマー", style: "margin:0" }),
        timerLabel,
      ]),
      el("p", { class: "muted", style: "margin:6px 0 12px", text: "終了の1分前から音量が下がり、静かに切れます。" }),
      timerChips,
    ]),
    el("div", { class: "card" }, [
      el("h3", { text: "全体の音量" }),
      masterSlider,
      // iPhone の消音スイッチは、内蔵スピーカーの音だけを黙らせる。
      // イヤホンでは鳴るので原因に気づきにくく、必ず案内を出しておく。
      isIOS() && el("p", { class: "hint" }, [
        "スピーカーから音が出ないときは、本体側面の",
        el("strong", { text: "消音スイッチ（マナーモード）" }),
        "を確認してください。マナーモード中、iPhone はブラウザの音をスピーカーからは出しません",
        "（イヤホンや Bluetooth では鳴ります）。",
      ]),
      el("button", {
        class: "btn btn-ghost btn-sm", type: "button", style: "margin-top:8px",
        onclick: () => {
          stopAllLayers();
          stopBreathModulation();
          paintSway();
          activeTimer = 0;
          paintTimerChips();
          for (const id of Object.keys(LAYER_SPECS)) {
            const ui = controls.get(id);
            ui.wrap.dataset.on = "false";
            ui.toggle.setAttribute("aria-checked", "false");
          }
          persist();
        },
      }, ["すべて停止"]),
    ]),
  );

  // 別画面から戻ったときに再生状態を表示へ反映する。
  for (const id of Object.keys(LAYER_SPECS)) {
    const playing = getLayer(id).playing;
    const ui = controls.get(id);
    ui.wrap.dataset.on = String(playing);
    ui.toggle.setAttribute("aria-checked", String(playing));
  }

  return () => clearInterval(countdown);
}
