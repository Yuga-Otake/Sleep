/**
 * 呼吸パターンの時間計算。
 *
 * 描画（breath-graph）とセッション管理（breath-session）の両方が同じ計算を
 * 必要とするので、DOM に触れない純関数としてここに集めている。Node から
 * そのままテストできる。
 *
 * @typedef {{label:string, short:string, seconds:number, from:number, to:number, cue:number}} Phase
 *   from / to は肺の膨らみ（0 = 吐ききり、1 = 吸いきり）。
 */

/** 呼吸らしい加減速。始まりと終わりがゆっくりで、途中が速い。 */
export const ease = (p) => 0.5 - 0.5 * Math.cos(Math.PI * p);

/** 1呼吸にかかる秒数。 */
export function cycleLength(phases) {
  return phases.reduce((sum, phase) => sum + phase.seconds, 0);
}

/**
 * 時刻 t（秒）が属するフェーズ。サイクルをまたぐ t も受け付ける。
 * @returns {{phase: Phase, local: number, start: number}} local はフェーズ内の経過秒
 */
export function phaseAt(phases, t) {
  const cycle = cycleLength(phases);
  const inCycle = ((t % cycle) + cycle) % cycle;
  let start = 0;
  for (const phase of phases) {
    if (inCycle < start + phase.seconds) return { phase, local: inCycle - start, start };
    start += phase.seconds;
  }
  // 浮動小数の誤差で末尾を超えた場合は最後のフェーズの終端として扱う。
  const last = phases[phases.length - 1];
  return { phase: last, local: last.seconds, start: cycle - last.seconds };
}

/** 時刻 t における肺の膨らみ（0〜1）。サイクルをまたいでも連続する。 */
export function fullnessAt(phases, t) {
  const { phase, local } = phaseAt(phases, t);
  return phase.from + (phase.to - phase.from) * ease(local / phase.seconds);
}

/** t の時点で何呼吸目か（1始まり）。 */
export function breathNumber(phases, t) {
  return Math.floor(Math.max(0, t) / cycleLength(phases)) + 1;
}
