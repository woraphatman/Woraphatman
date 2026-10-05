// The key animation: press order, travel, stay-down, spring-back, flash, and a seamless loop.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildLayout, assignDays } from '../src/layout.js';
import { contributionLevel } from '../src/palette.js';
import { buildTimeline, keyDepth, todayFlash, liveDot, restTime, PRESS_DEPTH, TIMING } from '../src/timeline.js';

// --- press order on a hand-made board: lightest first, then left -> right, then top row first
const board = [
  { x: 5, z: 1, count: 3 }, // 0
  { x: 9, z: 2, count: 1 }, // 1
  { x: 2, z: 3, count: 1 }, // 2
  { x: 1, z: 0, count: 0 }, // 3 never moves
  { x: 0, z: 0, count: 39 }, // 4 darkest -> last
  { x: 2, z: 1, count: 1 }, // 5 same level and x as key 2, but a higher row -> first
];
const tl = buildTimeline(board, 39);
assert.deepEqual(tl.order, [5, 2, 1, 0, 4]);
assert.ok(Number.isNaN(tl.pressAt[3]));
for (let t = 0; t <= tl.loop; t += 0.01) assert.equal(keyDepth(tl, 3, t), 0, 'a zero-contribution key never moves');

// 0.7 x 4 mm travel, in 19.05 mm key units
assert.ok(Math.abs(PRESS_DEPTH - 0.14698) < 1e-4, `press depth ${PRESS_DEPTH}`);
assert.ok(Math.abs(keyDepth(tl, 5, tl.pressAt[5] + TIMING.press) - PRESS_DEPTH) < 1e-9, 'a key reaches full depth');

// keys stay down while the rest are eaten
const lastBottom = tl.pressAt[4] + TIMING.press;
assert.ok(Math.abs(keyDepth(tl, 5, lastBottom) - PRESS_DEPTH) < 1e-9, 'the first key is still down when the last one lands');
assert.ok(tl.releaseBase >= lastBottom + TIMING.hold - 1e-9, 'the board lets go only after the darkest key is down');

// the next key starts 45-90 ms after the previous
for (let r = 1; r < tl.order.length; r += 1) {
  const gap = tl.pressAt[tl.order[r]] - tl.pressAt[tl.order[r - 1]];
  assert.ok(gap >= 0.045 - 1e-9 && gap <= 0.09 + 1e-9, `step ${gap}`);
}

// --- the real board
const data = JSON.parse(readFileSync(new URL('../data.json', import.meta.url), 'utf8'));
const { keys } = buildLayout();
const placed = assignDays(keys, data.days).map((k) => ({ x: k.x, z: k.z, count: k.day.count }));
const max = Math.max(...placed.map((k) => k.count));
const real = buildTimeline(placed, max);

assert.ok(real.loop >= 5 && real.loop <= 7, `loop ${real.loop}s`);
assert.equal(real.order.length, placed.filter((k) => k.count > 0).length);
const tuple = (i) => [contributionLevel(placed[i].count, max), placed[i].x, placed[i].z];
for (let r = 1; r < real.order.length; r += 1) {
  const [l0, x0, z0] = tuple(real.order[r - 1]);
  const [l1, x1, z1] = tuple(real.order[r]);
  assert.ok(l0 < l1 || (l0 === l1 && (x0 < x1 || (x0 === x1 && z0 <= z1))), `order broke at rank ${r}`);
}
assert.equal(placed[real.order.at(-1)].count, max, 'the darkest key goes down last');
placed.forEach((k, i) => {
  if (k.count === 0) assert.ok(Number.isNaN(real.pressAt[i]), 'zero days are not scheduled');
});

// the loop closes: everything home and the glow at rest at t = 0 and t = loop, and the dot blinks a whole number of times
for (const t of [0, real.loop, restTime(real)]) {
  placed.forEach((_, i) => assert.ok(Math.abs(keyDepth(real, i, t)) < 1e-9, `key ${i} not home at t=${t}`));
  assert.equal(todayFlash(real, t), 0);
}
assert.ok(Math.abs(real.loop / real.blinkPeriod - Math.round(real.loop / real.blinkPeriod)) < 1e-9);
assert.equal(liveDot(real, 0), liveDot(real, real.loop - 1e-9) === 1 ? 0 : 1, 'the dot is in opposite phase just before the seam, so it keeps blinking evenly');

// motion is smooth (no jumps between 1/240 s samples) and the spring-back overshoots only a little
let maxStep = 0;
let minDepth = 0;
let maxDepth = 0;
const dt = 1 / 240;
for (let t = 0; t < real.loop; t += dt) {
  for (let i = 0; i < placed.length; i += 1) {
    const d0 = keyDepth(real, i, t);
    maxStep = Math.max(maxStep, Math.abs(keyDepth(real, i, t + dt) - d0));
    minDepth = Math.min(minDepth, d0);
    maxDepth = Math.max(maxDepth, d0);
  }
}
assert.ok(maxStep < PRESS_DEPTH * 0.08, `largest per-sample step ${maxStep}`);
assert.ok(minDepth > -0.25 * PRESS_DEPTH, `overshoot ${minDepth}`);
assert.ok(maxDepth <= PRESS_DEPTH + 1e-9);

// after the board springs up, today's key flashes once
let peak = 0;
let peakAt = 0;
for (let t = 0; t < real.loop; t += 0.005) {
  const f = todayFlash(real, t);
  if (f > peak) [peak, peakAt] = [f, t];
}
assert.ok(peak > 0.99, `flash peak ${peak}`);
assert.ok(peakAt > real.releaseBase, 'the flash comes after the board lets go');
assert.ok(peakAt < real.loop - TIMING.rest + 1e-9, 'the flash is over before the rest');

process.stdout.write(`timeline ok: ${real.order.length} keys, step ${(real.step * 1000).toFixed(0)} ms, loop ${real.loop.toFixed(2)} s, blink ${(real.blinkPeriod * 1000).toFixed(0)} ms
`);
