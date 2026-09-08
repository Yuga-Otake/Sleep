/** 画面をまたいで使う小さなヘルパー群。DOM 生成と時刻計算だけを持つ。 */

/** タグ・属性・子要素から要素を作る。属性値 null / undefined / false は無視。 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/* ---------- 時刻 ---------- */

/** "HH:MM" → 0:00 からの分数。不正な入力は null。 */
export function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 分数 → "HH:MM"。24時間を超えた値・負の値も一日に丸めて表示する。 */
export function toHHMM(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** 就床→起床のように日をまたぐ差分を、正の分数として返す。 */
export function spanMinutes(fromMin, toMin) {
  const diff = toMin - fromMin;
  return diff >= 0 ? diff : diff + 1440;
}

/** 分数 → "7時間30分" 形式。 */
export function formatDuration(minutes) {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}分`;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}

/** 秒 → "M:SS"。 */
export function formatClock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function todayISO(date = new Date()) {
  const offsetMs = date.getTime() - date.getTimezoneOffset() * 60000;
  return new Date(offsetMs).toISOString().slice(0, 10);
}

/** "2026-09-07" → "9/7(月)"。 */
export function formatDateShort(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const dow = "日月火水木金土"[date.getDay()];
  return `${m}/${d}(${dow})`;
}

/* ---------- 画面 ---------- */

let toastTimer = 0;
export function toast(message) {
  const node = document.getElementById("toast");
  if (!node) return;
  node.textContent = message;
  node.dataset.show = "true";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.dataset.show = "false"; }, 2600);
}

/**
 * iOS かどうか。iPadOS は MacIntel を名乗るのでタッチ点数で見分ける。
 * 消音スイッチの案内を出すかどうかの判定にだけ使う。
 */
export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** セッション中の画面消灯を防ぐ。未対応ブラウザでは黙って何もしない。 */
export function createWakeLock() {
  let sentinel = null;
  const supported = "wakeLock" in navigator;

  const request = async () => {
    if (!supported || sentinel) return;
    try {
      sentinel = await navigator.wakeLock.request("screen");
      sentinel.addEventListener("release", () => { sentinel = null; });
    } catch { sentinel = null; }
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && sentinel === null && wantsLock) request();
  });

  let wantsLock = false;
  return {
    supported,
    async acquire() { wantsLock = true; await request(); },
    release() {
      wantsLock = false;
      sentinel?.release?.().catch(() => {});
      sentinel = null;
    },
  };
}
