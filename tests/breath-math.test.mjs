import assert from "node:assert/strict";
import { cycleLength, phaseAt, fullnessAt, breathNumber, ease } from "../js/breath-math.js";

const P478 = [
  { label: "吸う", seconds: 4, from: 0, to: 1 },
  { label: "止める", seconds: 7, from: 1, to: 1 },
  { label: "吐く", seconds: 8, from: 1, to: 0 },
];

assert.equal(cycleLength(P478), 19);

// 境界: 各フェーズの先頭は次のフェーズに属する
assert.equal(phaseAt(P478, 0).phase.label, "吸う");
assert.equal(phaseAt(P478, 3.99).phase.label, "吸う");
assert.equal(phaseAt(P478, 4).phase.label, "止める");
assert.equal(phaseAt(P478, 11).phase.label, "吐く");
assert.equal(phaseAt(P478, 18.99).phase.label, "吐く");

// サイクルをまたいでも同じ位置に戻る
assert.equal(phaseAt(P478, 19).phase.label, "吸う");
assert.equal(phaseAt(P478, 19 * 3 + 5).phase.label, "止める");
assert.ok(Math.abs(fullnessAt(P478, 2) - fullnessAt(P478, 19 + 2)) < 1e-12);

// 端点: 吐ききり 0、吸いきり 1
assert.ok(Math.abs(fullnessAt(P478, 0) - 0) < 1e-12);
assert.ok(Math.abs(fullnessAt(P478, 4) - 1) < 1e-12);   // 吸い終わり
assert.ok(Math.abs(fullnessAt(P478, 10) - 1) < 1e-12);  // 止めている間はそのまま

// 膨らみは常に 0〜1 に収まり、吸気中は単調に増える
let prev = -1;
for (let t = 0; t <= 4; t += 0.1) {
  const v = fullnessAt(P478, t);
  assert.ok(v >= 0 && v <= 1, `範囲外: ${v}`);
  assert.ok(v >= prev, `吸気中に減少した: t=${t}`);
  prev = v;
}

// 呼吸数のカウント
assert.equal(breathNumber(P478, 0), 1);
assert.equal(breathNumber(P478, 18.9), 1);
assert.equal(breathNumber(P478, 19), 2);
assert.equal(breathNumber(P478, -5), 1);   // 負の時刻でも 1 を下回らない

// 止める区間が両端で同じ値のパターン（ボックス呼吸の後半）でも平坦
const flat = [{ seconds: 4, from: 0, to: 0 }];
assert.equal(fullnessAt(flat, 2), 0);

// ease は 0→0, 1→1, 中央 0.5
assert.ok(Math.abs(ease(0)) < 1e-12);
assert.ok(Math.abs(ease(1) - 1) < 1e-12);
assert.ok(Math.abs(ease(0.5) - 0.5) < 1e-12);

console.log("breath-math: すべてのテストが通りました");
