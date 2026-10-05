#!/usr/bin/env node
// Renders index.html?still=1 in headless Chrome/Edge and writes the still images.
//
//   node capture.mjs                 final: out/banner-day.png + out/banner-night.png (1600x600 CSS px @2x = 3200x1200) and out/closeup.png
//   node capture.mjs --quick         fast iteration preview: DPR 1, few samples -> out/_scratch/preview-<theme>.png
//   options: --theme=day|night|both  --gl=gpu|swiftshader (software GL, as on a GPU-less CI runner; output goes to out/_scratch/swiftshader)
//            --samples=N  --scale=N  --only=hero|closeup  --view=name (one camera preset -> out/_scratch/view-<name>-<theme>.png)
//            --t=<seconds into the animation loop>  --out=dir  --cdn (do not serve three locally)
//            --q="exp=0.9&bloom=0"  extra query string for look-dev overrides (see TUNE in main.js)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT, parseArgs, startServer, launchBrowser, openStill, seconds, log } from './capture-lib.mjs';

const args = parseArgs(process.argv.slice(2));
const GL = args.gl === 'swiftshader' ? 'swiftshader' : 'gpu';
const QUICK = Boolean(args.quick);
const SCALE = Number(args.scale ?? (QUICK ? 1 : 2));
const SAMPLES = Number(args.samples ?? (QUICK ? 24 : 192));
const OUT = resolve(ROOT, args.out ?? (GL === 'swiftshader' ? 'out/_scratch/swiftshader' : 'out'));
const SCRATCH = GL === 'swiftshader' ? OUT : join(OUT, '_scratch');
const THEMES = args.theme === 'both' || args.theme === undefined ? ['day', 'night'] : [args.theme];
const WIDE = { width: 1600, height: 600 };
const PANEL = { width: 800, height: 600 };
const PAGE_COLOR = { day: '#FAF4E6', night: '#0d1117' };
const timings = [];

async function shot(browser, port, { query, size, scale, file, label }) {
  const extra = args.q ? `&${args.q}` : '';
  const at = args.t !== undefined ? `&t=${args.t}` : '';
  const { page, stats, renderer, loadMs } = await openStill(browser, port, { query: `${query}${at}${extra}`, size, scale, samples: SAMPLES, cdn: args.cdn, label });
  const buf = await page.screenshot({ type: 'png', captureBeyondViewport: false });
  writeFileSync(file, buf);
  log(`  ${file}  ${stats.width}x${stats.height}px  ${stats.samples} samples  render ${seconds(stats.ms)}s  total ${seconds(loadMs)}s  GL: ${renderer}`);
  timings.push({ label, renderMs: stats.ms, totalMs: loadMs, renderer });
  await page.close();
  return buf;
}

/** Two close-up panels (tall keys + legend | OLED), stitched side by side into one image. */
async function stitch(browser, left, right, file, scale, theme) {
  const page = await browser.newPage();
  await page.setViewport({ width: PANEL.width * 2, height: PANEL.height, deviceScaleFactor: scale });
  await page.setContent(`<body style="margin:0;background:${PAGE_COLOR[theme]}"><canvas id=c></canvas></body>`);
  const dataUrl = await page.evaluate(
    async (a, b, w, h, s, gap) => {
      const load = (src) => new Promise((ok, no) => Object.assign(new Image(), { onload() { ok(this); }, onerror: no, src }));
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const c = document.getElementById('c');
      c.width = w * 2 * s;
      c.height = h * s;
      const ctx = c.getContext('2d');
      ctx.drawImage(ia, 0, 0, w * s, h * s);
      ctx.drawImage(ib, w * s, 0, w * s, h * s);
      ctx.fillStyle = gap;
      ctx.fillRect(w * s - 1, 0, 2, h * s);
      return c.toDataURL('image/png');
    },
    `data:image/png;base64,${left.toString('base64')}`,
    `data:image/png;base64,${right.toString('base64')}`,
    PANEL.width,
    PANEL.height,
    scale,
    PAGE_COLOR[theme],
  );
  writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  log(`  ${file}  (keys | OLED close-up)`);
  await page.close();
}

async function main() {
  mkdirSync(SCRATCH, { recursive: true });
  const { server, port } = await startServer();
  const { browser, executablePath } = await launchBrowser({ gl: GL });
  log(`browser: ${executablePath}\nserver:  http://127.0.0.1:${port}  gl=${GL} samples=${SAMPLES} scale=${SCALE} themes=${THEMES.join(',')}`);
  const t0 = Date.now();
  try {
    for (const theme of THEMES) {
      const q = (view) => `view=${view}&theme=${theme}`;
      if (args.view) {
        const size = args.view === 'hero' ? WIDE : PANEL;
        await shot(browser, port, { query: q(args.view), size, scale: SCALE, file: join(SCRATCH, `view-${args.view}-${theme}.png`), label: `${args.view}/${theme}` });
        continue;
      }
      if (args.only !== 'closeup') {
        const file = QUICK ? join(SCRATCH, `preview-${theme}.png`) : join(OUT, `banner-${theme}.png`);
        await shot(browser, port, { query: q('hero'), size: WIDE, scale: SCALE, file, label: `hero/${theme}` });
      }
      if (args.only !== 'hero') {
        const keys = await shot(browser, port, { query: q('keys'), size: PANEL, scale: SCALE, file: join(SCRATCH, `panel-keys-${theme}.png`), label: `keys/${theme}` });
        const oled = await shot(browser, port, { query: q('oled'), size: PANEL, scale: SCALE, file: join(SCRATCH, `panel-oled-${theme}.png`), label: `oled/${theme}` });
        const name = theme === 'day' ? (QUICK ? 'closeup-preview.png' : 'closeup.png') : `closeup-${theme}.png`;
        await stitch(browser, keys, oled, join(theme === 'day' && !QUICK ? OUT : SCRATCH, name), SCALE, theme);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  const render = timings.reduce((sum, t) => sum + t.renderMs, 0);
  log(`done: ${timings.length} renders, in-page render ${seconds(render)}s, wall ${seconds(Date.now() - t0)}s`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
