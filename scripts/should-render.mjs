#!/usr/bin/env node
// Decides whether the banner has to be rendered: compares the fresh data.json with the one published on the output branch.
//
//   node scripts/should-render.mjs --fresh=data.json --published=published-data.json --event=$GITHUB_EVENT_NAME
//
// Prints the decision and its reason, and writes render=true|false to $GITHUB_OUTPUT when that is set.
// Only the hourly schedule can skip. A push that changes render code and a manual run always render, because the
// look of the banner can change without the data changing.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { contentHash } from '../fetch_data.mjs';

const readJson = (file) => {
  if (!file || !existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/** @returns {{render: boolean, reason: string}} */
export function decide({ event, fresh, published }) {
  if (event !== 'schedule') return { render: true, reason: `${event || 'a local run'} always renders` };
  if (!fresh) return { render: true, reason: 'there is no fresh data to compare' };
  if (!published) return { render: true, reason: 'nothing is published on the output branch yet' };
  if (contentHash(fresh) !== contentHash(published)) return { render: true, reason: 'the contribution data changed' };
  return { render: false, reason: `the data is unchanged since ${published.generatedAt ?? 'the last render'}` };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [k, ...rest] = a.slice(2).split('=');
    return [k, rest.join('=')];
  }));
  const { render, reason } = decide({ event: args.event, fresh: readJson(args.fresh), published: readJson(args.published) });
  process.stdout.write(`render=${render}: ${reason}\n`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `render=${render}\n`);
}
