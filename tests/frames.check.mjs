// Frame de-duplication: frames with the same pose fingerprint are rendered once, and only when nothing on screen can differ.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planFrames } from '../capture-lib.mjs';
import { buildLayout, assignDays } from '../src/layout.js';
import { buildTimeline, keyDepth, liveDot, poseKey, todayFlash, TIMING } from '../src/timeline.js';

// the plan on its own: first occurrence renders, repeats copy it, and de-duplication can be switched off
assert.deepEqual(planFrames(['a', 'a', 'b', 'a', 'c', 'c']), { source: [0, 0, 2, 0, 4, 4], unique: [0, 2, 4] });
assert.deepEqual(planFrames(['a', 'a', 'b'], false), { source: [0, 1, 2], unique: [0, 1, 2] });

// the real loop, at the capture's 60 ms per frame
const data = JSON.parse(readFileSync(new URL('../data.json', import.meta.url), 'utf8'));
const placed = assignDays(buildLayout().keys, data.days).map((k) => ({ x: k.x, z: k.z, count: k.day.count }));
const tl = buildTimeline(placed, Math.max(...placed.map((k) => k.count)));
const frames = Math.round((tl.loop * 1000) / 60);
const times = Array.from({ length: frames }, (_, i) => (i * tl.loop) / frames);
const fingerprint = (t) => poseKey(tl, placed.length, t);
const plan = planFrames(times.map(fingerprint));

// a frame is only a copy when every key depth, today's glow and the status dot agree with the frame it copies
plan.source.forEach((src, i) => {
  if (src === i) return;
  placed.forEach((_, k) => assert.ok(Math.abs(keyDepth(tl, k, times[i]) - keyDepth(tl, k, times[src])) < 1e-5, `frame ${i} copies ${src} but key ${k} moved`));
  assert.ok(Math.abs(todayFlash(tl, times[i]) - todayFlash(tl, times[src])) < 1e-5, `frame ${i} copies ${src} but the glow changed`);
  assert.equal(liveDot(tl, times[i]), liveDot(tl, times[src]), `frame ${i} copies ${src} but the dot changed`);
});

// the lead-in before the first key moves is one frame
const lead = times.map((t, i) => [t, i]).filter(([t]) => t < Math.min(TIMING.lead, tl.blinkPeriod / 2));
assert.ok(lead.length >= 4, 'the lead-in spans several frames');
for (const [, i] of lead) assert.equal(plan.source[i], 0, `frame ${i} of the lead-in is a copy of frame 0`);
assert.ok(plan.unique.length < frames && plan.unique.length > frames * 0.7, `${plan.unique.length} distinct of ${frames} frames`);

// the blinking status dot makes otherwise identical rest frames distinct
const restFrames = times.filter((t) => t > tl.loop - TIMING.rest);
const dotStates = new Set(restFrames.map((t) => liveDot(tl, t)));
const keysAtRest = new Set(restFrames.map(fingerprint));
assert.equal(keysAtRest.size, dotStates.size, 'rest frames differ exactly when the dot does');

process.stdout.write(`frames ok: ${plan.unique.length} distinct of ${frames} frames\n`);
