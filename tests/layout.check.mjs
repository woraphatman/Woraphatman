// The key grid must be a standard ANSI 75% layout: 16u wide rows, ANSI stagger, contiguous F-row, arrows bottom-right.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildLayout, assignDays, ROWS, LAYOUT_WIDTH } from '../src/layout.js';

const { keys, knob, width, depth } = buildLayout();
const byId = (id) => keys.find((k) => k.id === id);
const rowKeys = (r) => keys.filter((k) => k.row === r);
const widths = (r) => rowKeys(r).map((k) => k.w);
const repeat = (v, n) => Array(n).fill(v);

// every row is exactly 16u wide (row 0 counts the knob slot)
assert.equal(width, 16);
assert.equal(LAYOUT_WIDTH, 16);
ROWS.forEach((row, r) => {
  const total = row.reduce((sum, item) => sum + item.w, 0);
  assert.equal(total, 16, `row ${r} is ${total}u wide`);
});
assert.equal(depth, 6, 'six rows, no gap between the F-row and the number row');

// ANSI stagger and widths for rows 1-5 (ids aside, these are the widths a stock 75% board has)
assert.deepEqual(widths(1), [...repeat(1, 13), 2, 1]);
assert.deepEqual(widths(2), [1.5, ...repeat(1, 12), 1.5, 1]);
assert.deepEqual(widths(3), [1.75, ...repeat(1, 11), 2.25, 1]);
assert.deepEqual(widths(4), [2.25, ...repeat(1, 10), 1.75, 1, 1]);
assert.deepEqual(widths(5), [1.25, 1.25, 1.25, 6.25, ...repeat(1, 3), ...repeat(1, 3)]);
assert.equal(keys.length, 83);

// row 0: Esc, F1-F12, PrtSc, Del, then the knob in the 16th column; contiguous 1u keys
const row0 = rowKeys(0);
assert.deepEqual(row0.map((k) => k.id), ['esc', ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`), 'prtsc', 'del']);
row0.forEach((k, i) => assert.equal(k.x, i + 0.5));
assert.deepEqual(knob, { x: 15.5, z: 0.5 });

// QWERTY stagger: Q starts 1.5u in, A 1.75u, Z 2.25u
assert.equal(byId('q').x - 0.5, 1.5);
assert.equal(byId('a').x - 0.5, 1.75);
assert.equal(byId('z').x - 0.5, 2.25);

// 6.25u spacebar spanning x 3.75..10
const space = byId('space');
assert.equal(space.w, 6.25);
assert.equal(space.x - space.w / 2, 3.75);
assert.equal(space.x + space.w / 2, 10);

// arrow cluster in the last three columns, Up directly above Down
assert.equal(byId('left').x, 13.5);
assert.equal(byId('down').x, 14.5);
assert.equal(byId('right').x, 15.5);
assert.equal(byId('up').x, byId('down').x);
assert.equal(byId('up').row, 4);
assert.equal(byId('down').row, 5);

// rows touch: z is row + 0.5, so there is no vertical gap anywhere
keys.forEach((k) => assert.equal(k.z, k.row + 0.5));

// no two keys overlap
const rect = (k) => ({ x0: k.x - k.w / 2, x1: k.x + k.w / 2, z0: k.z - 0.5, z1: k.z + 0.5 });
for (let i = 0; i < keys.length; i += 1) {
  for (let j = i + 1; j < keys.length; j += 1) {
    const a = rect(keys[i]);
    const b = rect(keys[j]);
    const overlap = a.x0 < b.x1 - 1e-9 && b.x0 < a.x1 - 1e-9 && a.z0 < b.z1 - 1e-9 && b.z0 < a.z1 - 1e-9;
    assert.ok(!overlap, `${keys[i].id} overlaps ${keys[j].id}`);
  }
}

// days: oldest -> Esc, today -> the last key (right arrow); every key carries a day
const data = JSON.parse(readFileSync(new URL('../data.json', import.meta.url), 'utf8'));
const withDays = assignDays(keys, data.days);
assert.ok(withDays.every((k) => k.day), 'every key has a day');
assert.equal(withDays[0].id, 'esc');
assert.equal(withDays[0].day.date, data.days.at(-83).date);
assert.equal(withDays.at(-1).id, 'right');
assert.equal(withDays.at(-1).day.date, data.days.at(-1).date);
const dates = withDays.map((k) => k.day.date);
assert.deepEqual(dates, [...dates].sort(), 'days increase in reading order');

process.stdout.write(`layout ok: ${keys.length} keys + knob, 16u rows, depth ${depth}u
`);
