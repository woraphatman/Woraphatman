// Printed decals: the lettering exists for every character used, and the legend swatches are the key colours.
import assert from 'node:assert/strict';
import { wordAdvance } from '../src/decals.js';
import { legendColors, capColor, BRAND, ZERO_CAP } from '../src/palette.js';

for (const word of ['Nobxx', 'less', 'more']) {
  const w = wordAdvance(word, 0.3);
  assert.ok(Number.isFinite(w) && w > 0.5, `${word} advance ${w}`);
}
assert.throws(() => wordAdvance('Q', 0), 'a letter without a glyph must not pass silently');

// the five swatches, "less" -> "more": an empty day, then the lightest real day and the three brand stops (literal hex)
const hex = legendColors().map((c) => `#${c.getHexString()}`.toUpperCase());
assert.equal(hex.length, 5);
assert.equal(hex[0], ZERO_CAP.toUpperCase());
assert.equal(hex[2], BRAND.duckYellow);
assert.equal(hex[3], BRAND.deepAmber);
assert.equal(hex[4], BRAND.beakOrange);
assert.notEqual(hex[1], hex[0]);
assert.notEqual(hex[1], hex[2]);

// the swatches are what the keys use: a one-contribution day and the busiest day
assert.equal(`#${capColor(0, 39).getHexString()}`.toUpperCase(), hex[0]);
assert.equal(`#${capColor(1, 39).getHexString()}`.toUpperCase(), hex[1]);
assert.equal(`#${capColor(39, 39).getHexString()}`.toUpperCase(), hex[4]);

// brand law: the five exact hex values
assert.deepEqual(BRAND, { duckYellow: '#FFD43B', beakOrange: '#FF8A3C', pondNavy: '#242A38', deepAmber: '#E3A81C', cream: '#FAF4E6' });

process.stdout.write(`decals ok: ${hex.join(' ')}\n`);
