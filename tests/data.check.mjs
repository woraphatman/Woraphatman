// data.json holds aggregate counts only, and the derived numbers on the OLED are consistent with it.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUERY, contentHash, currentStreak, summarize } from '../fetch_data.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const data = JSON.parse(readFileSync(join(root, 'data.json'), 'utf8'));

// privacy: only these fields, and a day is just a date and a count (no repository names, titles or organisations)
const allowed = ['login', 'yearTotal', 'todayCount', 'weekTotal', 'currentStreak', 'asOf', 'generatedAt', 'days'];
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
const sum = (list) => list.reduce((a, b) => a + b, 0);
assert.equal(data.todayCount, counts.at(-1));
assert.equal(data.weekTotal, sum(counts.slice(-7)));
assert.equal(data.asOf, dates.at(-1));
assert.equal(data.currentStreak, currentStreak(counts));
assert.equal(data.yearTotal, sum(counts));

// the query asks for the calendar of one named user and nothing that could identify private work
assert.match(QUERY, /user\(login: \$login\)/);
for (const word of ['viewer', 'repositor', 'pullrequest', 'organization', 'nameWithOwner', 'issue', 'restricted', 'email']) {
  assert.ok(!QUERY.toLowerCase().includes(word.toLowerCase()), `the query selects ${word}`);
}

// summarize() copies a fixed list of fields: a response that carries repository names, titles or e-mail addresses leaks none of them
const day = (date, contributionCount) => ({ date, contributionCount, color: '#216e39', weekday: 1 });
const hostile = {
  data: {
    user: {
      login: 'someone',
      email: 'someone@example.com',
      repositories: { nodes: [{ nameWithOwner: 'someone/secret-project' }] },
      contributionsCollection: {
        restrictedContributionsCount: 4,
        pullRequestContributions: { nodes: [{ pullRequest: { title: 'secret title' } }] },
        contributionCalendar: {
          totalContributions: 12,
          weeks: [
            { contributionDays: [day('2026-09-28', 0), day('2026-09-29', 5), day('2026-09-30', 1), day('2026-10-01', 2), day('2026-10-02', 0)] },
            { contributionDays: [day('2026-10-03', 3), day('2026-10-04', 1)] },
          ],
        },
      },
    },
  },
};
const summary = summarize(hostile, new Date('2026-10-05T10:00:00Z'));
assert.deepEqual(Object.keys(summary).sort(), [...allowed].sort());
assert.deepEqual(Object.keys(summary.days[0]).sort(), ['count', 'date']);
assert.ok(!/secret|example\.com/.test(JSON.stringify(summary)), 'private details reached the summary');
assert.equal(summary.yearTotal, 12);
assert.equal(summary.todayCount, 1);
assert.equal(summary.weekTotal, 12, 'seven days: 0 + 5 + 1 + 2 + 0 + 3 + 1');
assert.equal(summary.currentStreak, 2, '10-04 and 10-03 have contributions, 10-02 does not');
assert.equal(summary.asOf, '2026-10-04');
assert.equal(summary.generatedAt, '2026-10-05T10:00:00.000Z');
assert.throws(() => summarize({ data: { user: null } }), /no such user/);
assert.throws(() => summarize({ errors: [{ message: 'Bad credentials' }] }), /Bad credentials/);

// the skip check hashes everything except generatedAt
assert.equal(contentHash({ ...data, generatedAt: '2031-01-01T00:00:00.000Z' }), contentHash(data), 'the fetch time must not change the hash');
assert.equal(contentHash(Object.fromEntries(Object.entries(data).reverse())), contentHash(data), 'key order must not change the hash');
const bumped = structuredClone(data);
bumped.days.at(-1).count += 1;
assert.notEqual(contentHash(bumped), contentHash(data), 'a changed count must change the hash');
const shifted = { ...structuredClone(data), asOf: '2031-01-01' };
assert.notEqual(contentHash(shifted), contentHash(data), 'a new day must change the hash');

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
