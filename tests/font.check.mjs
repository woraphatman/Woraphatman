import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { PixelGrid } from '../src/pixelFont.js';

// every glyph is 5 columns wide and 7-8 rows tall, drawn with '.' and '#' only
const src = fs.readFileSync(new URL('../src/pixelFont.js', import.meta.url), 'utf8');
const re = /^\s*(?:'(.)'|(\w)):\s*G\('([^']+)'\)/gm;
let m;
let count = 0;
const bad = [];
while ((m = re.exec(src))) {
  const rows = m[3].split('/');
  count += 1;
  if (rows.length < 7 || rows.length > 8 || rows.some((r) => r.length !== 5 || /[^.#]/.test(r))) bad.push(m[1] ?? m[2]);
}
assert.ok(count >= 60, `parsed ${count} glyphs`);
assert.deepEqual(bad, [], `malformed glyphs: ${bad}`);

// every character the OLED can print has a glyph (a missing one would silently draw as a blank)
const used = 'TODAYWEKSR@woraphatmn0123456789:contribsdys 7ue';
for (const ch of new Set(used)) {
  if (ch === ' ') continue;
  const g = new PixelGrid(8, 9);
  g.text(ch, 0, 0);
  assert.ok(g.data.some((v) => v > 0), `no glyph for "${ch}"`);
}

// text advances 6 dots per character and returns the x after the last glyph
const g = new PixelGrid(100, 9);
assert.equal(g.text('abc', 4, 0), 4 + 3 * 6);
assert.ok(g.data.slice(0, 100).every((v, x) => x >= 4 || v === 0), 'nothing drawn left of the start');

process.stdout.write(`font ok: ${count} glyphs\n`);
