#!/usr/bin/env node
// Assembles dist/, the contents of the orphan `output` branch that GitHub Pages serves:
//   banner-day.gif, banner-night.gif   the README banner (loaded from raw.githubusercontent.com)
//   data.json                          aggregates only; also the record the next hourly run compares against
//   index.html, main.js, src/          the live, interactive page (three.js comes from the jsDelivr CDN)
//
//   node scripts/build-dist.mjs --gifs=out/ci [--dist=dist]
import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_GIF_BYTES = 5 * 1048576; // GitHub's README image proxy gives up on larger files
const GIFS = ['banner-day.gif', 'banner-night.gif'];
const SITE = ['index.html', 'main.js', 'data.json', 'src'];

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const [k, ...rest] = a.slice(2).split('=');
  return [k, rest.join('=')];
}));
const gifDir = resolve(ROOT, args.gifs ?? 'out');
const dist = resolve(ROOT, args.dist ?? 'dist');

for (const name of GIFS) {
  const file = join(gifDir, name);
  if (!existsSync(file)) throw new Error(`missing ${file}`);
  const bytes = statSync(file).size;
  if (bytes > MAX_GIF_BYTES) throw new Error(`${name} is ${(bytes / 1048576).toFixed(2)} MB, over the 5 MB limit`);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const name of SITE) cpSync(join(ROOT, name), join(dist, name), { recursive: true });
for (const name of GIFS) cpSync(join(gifDir, name), join(dist, name));
writeFileSync(join(dist, '.nojekyll'), ''); // serve the files as they are, no Jekyll build

process.stdout.write(`dist ready: ${[...GIFS, ...SITE, '.nojekyll'].join(', ')}\n`);
