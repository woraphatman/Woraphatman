// The hourly run skips the render only when the published data and the fresh data are the same banner.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decide } from '../scripts/should-render.mjs';

const data = JSON.parse(readFileSync(new URL('../data.json', import.meta.url), 'utf8'));
const later = { ...data, generatedAt: '2031-01-01T00:00:00.000Z' };
const bumped = structuredClone(data);
bumped.days.at(-1).count += 1;
bumped.todayCount += 1;

// the schedule skips when only the fetch time differs
assert.deepEqual(decide({ event: 'schedule', fresh: later, published: data }).render, false);
// ... and renders as soon as a count differs, or nothing is published yet
assert.equal(decide({ event: 'schedule', fresh: bumped, published: data }).render, true);
assert.equal(decide({ event: 'schedule', fresh: data, published: null }).render, true);
assert.equal(decide({ event: 'schedule', fresh: null, published: data }).render, true);
// a push and a manual run render even when the data is identical
assert.equal(decide({ event: 'push', fresh: data, published: data }).render, true);
assert.equal(decide({ event: 'workflow_dispatch', fresh: data, published: data }).render, true);
assert.equal(decide({ event: undefined, fresh: data, published: data }).render, true);

process.stdout.write('skip ok: schedule skips unchanged data only\n');
