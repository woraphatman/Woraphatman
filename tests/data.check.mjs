// data.json holds aggregate counts only, and the derived numbers on the OLED are consistent with it.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentStreak } from '../fetch_data.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const data = JSON.parse(readFileSync(join(root, 'data.json'), 'utf8'));

// privacy: only these fields, and a day is just a date and a count (no repository names, titles or organisations)
const allowed = ['login', 'yearTotal', 'todayCount', 'openPRs', 'repoCount', 'currentStreak', 'asOf', 'generatedAt', 'days'];
assert.deepEqual(Object.keys(data).sort(), [...allowed].sort());
for (const day of data.days) {
  assert.deepEqual(Object.keys(day).sort(), ['count', 'date']);
  assert.match(day.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Number.isInteger(day.count) && day.count >= 0);
}
const dates = data.days.map((d) => d.date);
assert.deepEqual(dates, [...dates].sort(), 'days are in order');
assert.equal(new Set(dates).size, dates.length, 'no duplicate days');

// numbers agree with each other
const counts = data.days.map((d) => d.count);
assert.equal(data.todayCount, counts.at(-1));
assert.equal(data.asOf, dates.at(-1));
assert.equal(data.currentStreak, currentStreak(counts));
assert.equal(data.yearTotal, counts.reduce((a, b) => a + b, 0));

// no account-name leftovers of the old brand anywhere in the project's own files
const skip = new Set(['node_modules', '.git', 'out']);
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|mjs|html|json|md|yml)$/.test(name) && name !== 'package-lock.json') files.push(p);
  }
};
walk(root);
const oldName = new RegExp(['qua', 'ck'].join(''), 'i'); // built from pieces so this file does not match itself
const offenders = files.filter((f) => oldName.test(readFileSync(f, 'utf8')));
assert.deepEqual(offenders, [], `old brand name found in ${offenders}`);

process.stdout.write(`data ok: ${data.days.length} days, streak ${data.currentStreak}, ${files.length} files free of the old brand name\n`);
