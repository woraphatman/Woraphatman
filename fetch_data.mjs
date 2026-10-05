#!/usr/bin/env node
// Fetches the owner's GitHub contribution calendar and writes data.json.
//
// PRIVACY: only aggregates are requested and written: login, totals, per-day counts. The GraphQL query below never asks
// for repository names, pull requests, organisations or anything else that could identify private work, and summarize()
// copies a fixed list of fields, so nothing extra can leak into data.json even if the response carries more.
//
// Owner: --owner=<login>, else $OWNER, else $GITHUB_REPOSITORY_OWNER (set by GitHub Actions), else the owner of the `origin` remote.
// Auth:  $GITHUB_TOKEN or $GH_TOKEN (the built-in Actions token is enough: the calendar is public, private work only adds to its counts);
//        without either, the token of the logged-in `gh` CLI.
//
// Days are UTC dates: GitHub timestamps contributions in UTC, so "today" rolls over at 00:00 UTC (07:00 in Asia/Bangkok).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'data.json');
const WEEK_DAYS = 7;

export const QUERY = `query($login: String!) {
  user(login: $login) {
    login
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`;

function parseArgs(argv) {
  return Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => {
    const [k, ...rest] = a.slice(2).split('=');
    return [k, rest.length ? rest.join('=') : true];
  }));
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function ownerLogin(args) {
  const explicit = args.owner ?? process.env.OWNER ?? process.env.GITHUB_REPOSITORY_OWNER;
  if (typeof explicit === 'string' && explicit) return explicit;
  try {
    const m = /github\.com[:/]([^/]+)\//.exec(git('remote', 'get-url', 'origin'));
    if (m) return m[1];
  } catch {
    // no git remote: fall through to the error below
  }
  throw new Error('Cannot tell whose calendar to fetch: pass --owner=<login> or set OWNER.');
}

function authToken() {
  const env = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (env) return env;
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    throw new Error('No GitHub token: set GITHUB_TOKEN or GH_TOKEN, or log in with `gh auth login`.');
  }
}

async function runQuery(login, token) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'profile-keyboard' },
    body: JSON.stringify({ query: QUERY, variables: { login } }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} ${res.statusText}`);
  return res.json();
}

/** Consecutive days with count > 0, ending today (or yesterday if today is still empty). */
export function currentStreak(counts) {
  let i = counts.length - 1;
  if (i >= 0 && counts[i] === 0) i -= 1;
  let streak = 0;
  while (i >= 0 && counts[i] > 0) {
    streak += 1;
    i -= 1;
  }
  return streak;
}

/** The GraphQL response reduced to the fields data.json is allowed to hold. */
export function summarize(payload, now = new Date()) {
  if (payload.errors) throw new Error(`GraphQL error: ${payload.errors.map((e) => e.message).join('; ').slice(0, 300)}`);
  const user = payload.data?.user;
  if (!user) throw new Error('GitHub returned no such user');
  const cal = user.contributionsCollection.contributionCalendar;
  const days = cal.weeks
    .flatMap((w) => w.contributionDays)
    .map((d) => ({ date: d.date, count: d.contributionCount }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const counts = days.map((d) => d.count);
  return {
    login: user.login,
    yearTotal: cal.totalContributions,
    todayCount: counts.at(-1) ?? 0,
    weekTotal: counts.slice(-WEEK_DAYS).reduce((sum, c) => sum + c, 0),
    currentStreak: currentStreak(counts),
    asOf: days.at(-1)?.date ?? null,
    generatedAt: now.toISOString(),
    days,
  };
}

/** Hash of everything in data.json except generatedAt: equal hashes mean the banner would look the same. */
export function contentHash(data) {
  const { generatedAt: _ignored, ...rest } = data;
  const canonical = (v) => {
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
    return JSON.stringify(v);
  };
  return createHash('sha256').update(canonical(rest)).digest('hex');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const login = ownerLogin(parseArgs(process.argv.slice(2)));
    const data = summarize(await runQuery(login, authToken()));
    writeFileSync(OUT, `${JSON.stringify(data, null, 1)}\n`);
    const last7 = data.days.slice(-WEEK_DAYS).map((d) => d.count).join(',');
    process.stdout.write(`data.json written: ${data.login} year=${data.yearTotal} today=${data.todayCount} week=${data.weekTotal} streak=${data.currentStreak} days=${data.days.length} last7=${last7} asOf=${data.asOf}\n`);
  } catch (err) {
    process.stderr.write(`fetch_data failed: ${err.message}\n`);
    process.exit(1);
  }
}
