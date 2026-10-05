#!/usr/bin/env node
// Renders one loop of the key animation frame by frame and assembles looping animated files.
//
//   node capture-anim.mjs                     out/banner-day.webp + .gif and out/banner-night.webp + .gif
//   options: --theme=day|night|both   --gl=gpu|swiftshader|mesa|lavapipe (software GL; output goes to out/_scratch/<gl>)
//            --profile=ci             cheap preset for GPU-less runners (see PROFILES in main.js); --samples=N overrides its sample count
//            --delay=60               ms per frame; multiple of 10 so GIF and WebP play at the same speed (60 ms = 16.7 fps)
//            --samples=96             accumulation samples per frame (anti-aliasing + soft shadows); multiple of 8
//            --webp-width=1600  --webp-quality=90  --gif-width=1600  --gif-colours=256  --gif-dither=1  --gif-noise=3  --gif-effort=10
//            --formats=webp,gif       --frames=N (override the frame count)   --out=dir
//            --limit=N  --from=K      render only N distinct frames, starting at the K-th (timing and parity probes); the encode step is skipped
//            --no-dedupe              render every frame even when its pose is identical to an earlier one
//            --encode-only            re-encode the frames already in out/_scratch/frames-* without rendering
//
// The camera never moves and the grain is fixed, so only the keys, today's glow and the OLED status dot change
// between frames; both formats store unchanged pixels once, which keeps the files small. Frames with an identical pose
// (the lead-in, the hold with every key down, the rest at the end) are rendered once and reused.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { ROOT, GL_BACKENDS, parseArgs, startServer, launchBrowser, openStill, cpuSeconds, planFrames, seconds, log } from './capture-lib.mjs';

const args = parseArgs(process.argv.slice(2));
const GL = GL_BACKENDS.includes(args.gl) ? args.gl : 'gpu';
// Chrome falls back to another rasteriser without a word when its first choice fails to start; a slow fallback must not go unnoticed.
const EXPECTED_RENDERER = { swiftshader: /swiftshader/i, mesa: /llvmpipe/i, lavapipe: /llvmpipe/i };
const THEMES = args.theme === undefined || args.theme === 'both' ? ['day', 'night'] : [args.theme];
const DELAY = Math.max(10, Math.round(Number(args.delay ?? 60) / 10) * 10);
const PROFILE = args.profile ?? 'default';
const SAMPLES = args.samples === undefined ? undefined : Number(args.samples);
const DEFAULT_SAMPLES = 96;
const FORMATS = String(args.formats ?? 'webp,gif').split(',');
const OUT = resolve(ROOT, args.out ?? (GL === 'gpu' ? 'out' : `out/_scratch/${GL}`));
const SCRATCH = GL === 'gpu' ? join(OUT, '_scratch') : OUT;
const VIEWPORT = { width: 1600, height: 600 };
const ENCODE = {
  webpWidth: Number(args['webp-width'] ?? 1600),
  webpQuality: Number(args['webp-quality'] ?? 90),
  gifWidth: Number(args['gif-width'] ?? 1600),
  gifColours: Number(args['gif-colours'] ?? 256),
  gifDither: Number(args['gif-dither'] ?? 1),
  gifNoise: Number(args['gif-noise'] ?? 3), // peak-to-peak levels of fixed-pattern noise added before GIF quantisation (hides banding)
  gifEffort: Number(args['gif-effort'] ?? 7), // 7 gives the same palette quality as 10 (0.24 levels apart) in 60 % of the time
};
const MB = (bytes) => (bytes / 1048576).toFixed(2);
const pad = (i) => String(i).padStart(4, '0');

/** Render every distinct frame of the loop into `dir` as PNG. Returns timing and loop metadata. */
async function renderFrames(theme, dir) {
  const { server, port } = await startServer();
  const { browser } = await launchBrowser({ gl: GL });
  const t0 = Date.now();
  const cpu0 = await cpuSeconds(browser);
  try {
    // t=0 makes the page's own first render frame 0 of the loop, so no render is wasted on a throw-away frame
    const first = await openStill(browser, port, {
      query: `view=hero&theme=${theme}&t=0${PROFILE === 'default' ? '' : `&profile=${PROFILE}`}`,
      size: VIEWPORT,
      scale: 1,
      samples: SAMPLES ?? (PROFILE === 'default' ? DEFAULT_SAMPLES : undefined),
      label: `anim/${theme}`,
    });
    const { page, timeline, renderer, stats } = first;
    if (EXPECTED_RENDERER[GL] && !EXPECTED_RENDERER[GL].test(renderer)) throw new Error(`--gl=${GL} expects a renderer matching ${EXPECTED_RENDERER[GL]}, but Chrome picked: ${renderer}`);
    const frames = Number(args.frames ?? Math.round((timeline.loop * 1000) / DELAY));
    const times = Array.from({ length: frames }, (_, i) => (i * timeline.loop) / frames);
    const poseKeys = await page.evaluate((ts) => ts.map((t) => window.__poseKeyAt(t)), times);
    const { source, unique } = planFrames(poseKeys, !args['no-dedupe']);
    const from = Number(args.from ?? 0);
    const todo = args.limit === undefined ? unique.slice(from) : unique.slice(from, from + Number(args.limit));
    log(`[${theme}] loop ${timeline.loop.toFixed(3)} s, ${timeline.keys} keys pressed, ${frames} frames x ${DELAY} ms (${unique.length} distinct, rendering ${todo.length}), ${stats.samples} samples, profile ${PROFILE}, GL: ${renderer}`);

    const renderMs = [];
    const cpuMarks = [];
    for (const [n, i] of todo.entries()) {
      const f0 = Date.now();
      const c0 = await cpuSeconds(browser);
      if (i !== 0) await page.evaluate((tt) => window.__renderAt(tt), times[i]);
      const buf = await page.screenshot({ type: 'png', captureBeyondViewport: false, optimizeForSpeed: true });
      writeFileSync(join(dir, `f${pad(i)}.png`), buf);
      renderMs.push(Date.now() - f0);
      cpuMarks.push((await cpuSeconds(browser)) - c0);
      if (n === 0 || (n + 1) % 10 === 0 || n === todo.length - 1) {
        const done = n + 1;
        const eta = ((Date.now() - t0) / done) * (todo.length - done);
        log(`  frame ${done}/${todo.length}  ${seconds(renderMs[n])}s  cpu ${cpuMarks[n].toFixed(1)}s  elapsed ${seconds(Date.now() - t0)}s  eta ${seconds(eta)}s`);
      }
    }
    const meta = {
      theme, gl: GL, renderer, profile: PROFILE, loop: timeline.loop, frames, delay: DELAY, samples: stats.samples,
      source, rendered: todo, renderMs, cpuSeconds: cpuMarks, cpuTotal: (await cpuSeconds(browser)) - cpu0, wallMs: Date.now() - t0,
    };
    writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta));
    await page.close();
    return meta;
  } finally {
    await browser.close();
    server.close();
  }
}

/** Per-pixel offsets in [-peak/2, peak/2], a pure function of the pixel's position, so every frame gets the same pattern. */
function noiseTable(pixels, peak) {
  const table = new Float32Array(pixels);
  for (let p = 0; p < pixels; p += 1) {
    let h = Math.imul(p + 1, 2654435761) >>> 0;
    h ^= h >>> 15;
    h = Math.imul(h, 2246822519) >>> 0;
    h ^= h >>> 13;
    table[p] = ((h & 1023) / 1023 - 0.5) * peak;
  }
  return table;
}

/** Load the frames as one tall raw RGB strip (what sharp wants for an animated image) and report how much changes. */
async function loadStrip(dir, meta, width, noise = 0) {
  const chunks = [];
  let height = 0;
  const changed = [];
  const loaded = new Map(); // frames that copy an earlier pose share its decoded pixels
  let prev = null;
  let table = null;
  for (let i = 0; i < meta.frames; i += 1) {
    const src = meta.source[i];
    let data = loaded.get(src);
    if (!data) {
      let img = sharp(join(dir, `f${pad(src)}.png`)).removeAlpha();
      if (width !== VIEWPORT.width) img = img.resize({ width, kernel: 'lanczos3' });
      const raw = await img.raw().toBuffer({ resolveWithObject: true });
      data = raw.data;
      height = raw.info.height;
      if (noise > 0) {
        table ??= noiseTable(raw.info.width * raw.info.height, noise);
        for (let p = 0; p < table.length; p += 1) {
          for (let c = 0; c < 3; c += 1) data[p * 3 + c] = Math.max(0, Math.min(255, Math.round(data[p * 3 + c] + table[p])));
        }
      }
      loaded.set(src, data);
    }
    chunks.push(data);
    if (prev) {
      let diff = 0;
      if (prev !== data) for (let p = 0; p < data.length; p += 3) if (data[p] !== prev[p] || data[p + 1] !== prev[p + 1] || data[p + 2] !== prev[p + 2]) diff += 1;
      changed.push(diff / (data.length / 3));
    }
    prev = data;
  }
  return { strip: Buffer.concat(chunks), width, height, changed };
}

const stripInput = ({ strip, width, height }, frames) => sharp(strip, { raw: { width, height: height * frames, channels: 3, pageHeight: height } });

async function encode(theme, dir, meta) {
  const results = [];
  const delays = Array(meta.frames).fill(DELAY);
  if (FORMATS.includes('webp')) {
    const t0 = Date.now();
    const loaded = await loadStrip(dir, meta, ENCODE.webpWidth);
    const file = join(OUT, `banner-${theme}.webp`);
    await stripInput(loaded, meta.frames).webp({ quality: ENCODE.webpQuality, effort: 6, loop: 0, delay: delays, smartSubsample: true }).toFile(file);
    const avg = loaded.changed.reduce((s, v) => s + v, 0) / Math.max(1, loaded.changed.length);
    results.push({ file, bytes: statSync(file).size, ms: Date.now() - t0, width: loaded.width, height: loaded.height, avgChanged: avg });
  }
  if (FORMATS.includes('gif')) {
    const t0 = Date.now();
    const loaded = await loadStrip(dir, meta, ENCODE.gifWidth, ENCODE.gifNoise);
    const file = join(OUT, `banner-${theme}.gif`);
    await stripInput(loaded, meta.frames)
      .gif({ colours: ENCODE.gifColours, dither: ENCODE.gifDither, effort: ENCODE.gifEffort, loop: 0, delay: delays, interFrameMaxError: 4, interPaletteMaxError: 6 })
      .toFile(file);
    results.push({ file, bytes: statSync(file).size, ms: Date.now() - t0, width: loaded.width, height: loaded.height });
  }
  for (const r of results) {
    const info = await sharp(r.file, { pages: -1 }).metadata();
    log(`  ${r.file}  ${MB(r.bytes)} MB  ${info.width}x${info.pageHeight ?? info.height} x ${info.pages} frames  loop=${info.loop}  encode ${seconds(r.ms)}s${r.avgChanged === undefined ? '' : `  avg changed pixels/frame ${(r.avgChanged * 100).toFixed(1)}%`}`);
  }
  return results;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const summary = [];
  for (const theme of THEMES) {
    const dir = join(SCRATCH, `frames-${theme}`);
    mkdirSync(dir, { recursive: true });
    let meta;
    if (args['encode-only'] && existsSync(join(dir, 'meta.json'))) {
      const everyFrame = Array.from({ length: JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')).frames }, (_, i) => i); // frame sets rendered before de-duplication existed
      meta = { source: everyFrame, rendered: everyFrame, cpuTotal: 0, ...JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) };
    } else meta = await renderFrames(theme, dir);
    const total = meta.renderMs.reduce((s, v) => s + v, 0);
    const cpu = (meta.cpuSeconds ?? []).reduce((sum, v) => sum + v, 0);
    log(`[${theme}] ${meta.rendered.length} frames rendered in ${seconds(total)}s (${seconds(total / meta.rendered.length)}s/frame, ${(cpu / meta.rendered.length).toFixed(1)} cpu-s/frame), wall ${seconds(meta.wallMs)}s`);
    if (args.limit !== undefined || args.from !== undefined) continue; // a partial set cannot be encoded
    const files = await encode(theme, dir, meta);
    summary.push({ theme, meta, files });
  }
  const over = summary.flatMap((s) => s.files).filter((f) => f.bytes > 5 * 1048576);
  if (over.length) log(`WARNING: over the 5 MB limit: ${over.map((f) => f.file).join(', ')}`);
}

main().catch((e) => {
  console.error(e.stack ?? e.message);
  process.exit(1);
});
