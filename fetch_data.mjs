#!/usr/bin/env node
// Fetches GitHub contribution aggregates and writes data.json.
//
// PRIVACY: only aggregates are requested and written. No repository names,
// no PR titles, no org names. The GraphQL query below never asks for them.
//
// Auth: uses the `gh` CLI (`gh api graphql`). If GITHUB_TOKEN is set it uses
// that with fetch() instead, which is handy for CI.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'data.json');

const QUERY = `{
  viewer {
    login
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      restrictedContributionsCount
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
    pullRequests(states: OPEN) { totalCount }
    repositories(ownerAffiliations: OWNER) { totalCount }
  }
}`;

async function runQuery() {
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'profile-keyboard' },
      body: JSON.stringify({ query: QUERY }),
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    return res.json();
  }
  const stdout = execFileSync('gh', ['api', 'graphql', '-f', `query=${QUERY}`], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout);
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

export function summarize(payload) {
  if (payload.errors) throw new Error(`GraphQL error: ${JSON.stringify(payload.errors).slice(0, 300)}`);
  const v = payload.data.viewer;
  const cal = v.contributionsCollection.contributionCalendar;
  const days = cal.weeks
    .flatMap((w) => w.contributionDays)
    .map((d) => ({ date: d.date, count: d.contributionCount }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const counts = days.map((d) => d.count);
  return {
    login: v.login,
    yearTotal: cal.totalContributions,
    todayCount: counts.at(-1) ?? 0,
    openPRs: v.pullRequests.totalCount,
    repoCount: v.repositories.totalCount,
    currentStreak: currentStreak(counts),
    asOf: days.at(-1)?.date ?? null,
    generatedAt: new Date().toISOString(),
    days,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const data = summarize(await runQuery());
    writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n');
    const last7 = data.days.slice(-7).map((d) => d.count).join(',');
    console.log(`data.json written: ${data.login} year=${data.yearTotal} today=${data.todayCount} ` + // guard:allow
      `openPRs=${data.openPRs} repos=${data.repoCount} streak=${data.currentStreak} days=${data.days.length} last7=${last7}`);
  } catch (err) {
    console.error('fetch_data failed:', err.message);
    process.exit(1);
  }
}
