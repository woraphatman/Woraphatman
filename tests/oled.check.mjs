// OLED composition: strings, fixed label/value columns, margins, a sparkline that stays inside the glass, no stray dots.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PixelGrid } from '../src/pixelFont.js';
import { drawOled, oledModel, barHeight, LAYOUT, OLED_W, OLED_H } from '../src/oledLayout.js';

const day = (i, count) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, count });
const sample = {
  login: 'someone',
  todayCount: 3,
  currentStreak: 2,
  yearTotal: 387,
  asOf: '2026-10-05',
  generatedAt: '2026-10-05T09:53:04.026Z',
  days: [...Array.from({ length: 20 }, (_, i) => day(i, 0)), day(20, 1), day(21, 39), day(22, 22), day(23, 3), day(24, 0), day(25, 2), day(26, 3)],
};

// strings come from the data, with honest units
const m = oledModel(sample);
assert.equal(m.login, '@someone');
const text = (row) => `${row.num} ${row.unit}`;
assert.deepEqual(m.rows.map((r) => [r.label, text(r)]), [
  ['TODAY', '3 contribs'],
  ['WEEK', '70 contribs'], // 1 + 39 + 22 + 3 + 0 + 2 + 3
  ['STREAK', '2 days'],
  ['2026', '387 this yr'],
]);
assert.deepEqual(m.last7, [1, 39, 22, 3, 0, 2, 3]);
assert.match(m.updated, /^\d\d:\d\d$/);
assert.ok(!m.rows.some((r) => /pr/i.test(r.label)), 'no pull request line any more');

const single = oledModel({ ...sample, todayCount: 1, currentStreak: 1 });
assert.equal(text(single.rows[0]), '1 contrib');
assert.equal(text(single.rows[2]), '1 day');

// the checked-in data.json produces the numbers it contains
const data = JSON.parse(readFileSync(new URL('../data.json', import.meta.url), 'utf8'));
const real = oledModel(data);
assert.equal(real.rows[0].num, String(data.days.at(-1).count));
assert.equal(real.rows[1].num, String(data.days.slice(-7).reduce((s, d) => s + d.count, 0)));
assert.equal(real.rows[3].num, String(data.yearTotal));

// --- layout
const grid = new PixelGrid(OLED_W, OLED_H);
const boxes = drawOled(grid, real, { live: 1 });
const lit = [];
for (let y = 0; y < OLED_H; y += 1) for (let x = 0; x < OLED_W; x += 1) if (grid.data[y * OLED_W + x] > 0) lit.push([x, y]);

// nothing in the side margins or off the glass
const M = LAYOUT.margin;
assert.ok(lit.every(([x, y]) => x >= M && x <= OLED_W - M - 1 && y >= 1 && y <= OLED_H - 2), 'a dot sits in the margin');

// fixed columns with padding: all labels share one x, all values share another, and the gap is clear
assert.equal(new Set(boxes.rows.map((r) => r.label.x0)).size, 1);
assert.equal(new Set(boxes.rows.map((r) => r.value.x0)).size, 1);
for (const r of boxes.rows) assert.ok(r.value.x0 - r.label.x1 >= 6, `label/value gap ${r.value.x0 - r.label.x1}`);
for (const r of boxes.rows) assert.ok(r.value.x1 <= OLED_W - M - 1, 'a value runs off the right margin');

// no two elements overlap
const named = {
  header: boxes.header,
  dot: boxes.dot,
  foot: boxes.foot,
  spark: boxes.spark,
  sparkLabel: boxes.sparkLabel,
  ...Object.fromEntries(boxes.rows.flatMap((r, i) => [[`label${i}`, r.label], [`value${i}`, r.value]])),
};
const hit = (a, b) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
const names = Object.keys(named);
for (let i = 0; i < names.length; i += 1) {
  for (let j = i + 1; j < names.length; j += 1) assert.ok(!hit(named[names[i]], named[names[j]]), `${names[i]} overlaps ${names[j]}`);
}

// the dotted rules are the only other content; every lit dot belongs to an element or a rule
const rules = [LAYOUT.ruleTopY, LAYOUT.ruleBottomY];
const owned = ([x, y]) => rules.includes(y) || Object.values(named).some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
const strays = lit.filter((p) => !owned(p));
assert.deepEqual(strays, [], `stray dots at ${JSON.stringify(strays)}`);

// sparkline: fully inside the glass, the right margin, the 7d label to its left, zero day = 1-dot tick, low day = 2+ dots
assert.ok(boxes.spark.x1 <= OLED_W - M - 1 && boxes.spark.x0 > boxes.sparkLabel.x1 + 2);
const S = LAYOUT.spark;
const barX = (i) => boxes.spark.x0 + i * (S.barW + S.gap);
const colHeight = (i) => {
  let h = 0;
  for (let y = S.baseY; y > S.baseY - S.maxH - 1 && grid.data[y * OLED_W + barX(i)] > 0; y -= 1) h += 1;
  return h;
};
const last7 = real.last7;
last7.forEach((v, i) => {
  const h = colHeight(i);
  if (v === 0) assert.equal(h, 1, 'a zero day draws a one-dot baseline tick');
  else assert.ok(h >= 2, 'a low day still draws a bar');
  assert.equal(h, barHeight(v, Math.max(...last7)), `bar ${i}`);
});
assert.equal(barHeight(0, 39), 1);
assert.equal(barHeight(1, 39), 2);
assert.equal(barHeight(39, 39), S.maxH);
assert.ok(grid.data[S.baseY * OLED_W + barX(last7.length - 1)] === 1, "today's bar is the brightest");

// the live dot blinks without moving anything else
const lit0 = new PixelGrid(OLED_W, OLED_H);
drawOled(lit0, real, { live: 0 });
const diff = [];
for (let i = 0; i < grid.data.length; i += 1) if (grid.data[i] !== lit0.data[i]) diff.push([i % OLED_W, Math.floor(i / OLED_W)]);
assert.ok(diff.length > 0, 'the dot changes');
assert.ok(diff.every(([x, y]) => (x >= boxes.dot.x0 && x <= boxes.dot.x1 && y >= boxes.dot.y0 && y <= boxes.dot.y1) || (x >= boxes.foot.x0 && x <= boxes.foot.x1 && y >= boxes.foot.y0 && y <= boxes.foot.y1)), 'only the status dot and the clock colon blink');

process.stdout.write(`oled ok: ${lit.length} lit dots, ${Object.keys(named).length} elements, no strays
`);
