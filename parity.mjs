#!/usr/bin/env node
// CI preflight: does a software-GL render (SwiftShader, what a GPU-less runner gets) match the hardware render?
//
//   node parity.mjs out/banner-day.png out/_scratch/swiftshader/banner-day.png
//
// Exits 1 if the software frame is black or flat, is missing a post effect (backdrop gradient, grain, bright OLED),
// or differs from the hardware frame by more than the tolerances below.
import sharp from 'sharp';
import { log } from './capture-lib.mjs';

const TOLERANCE = {
  meanAbs: 2.5, // mean |difference| over all channels, 0..255
  p99: 24, // 99th percentile of the per-pixel largest channel difference
  bigShare: 0.01, // share of pixels that differ by more than 40
  minMean: 20, // a black or washed-out frame has a mean luminance outside [minMean, maxMean]
  maxMean: 245,
  grainRatio: 2, // software grain std-dev within this factor of the hardware one
  gradientDelta: 6, // centre-to-corner luminance step of the backdrop may differ by this much
};

const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

async function load(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

function patchStats(img, x0, y0, w, h) {
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      const l = luma(img.data, (y * img.w + x) * 3);
      sum += l;
      sum2 += l * l;
      n += 1;
    }
  }
  const mean = sum / n;
  return { mean, std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)) };
}

/** Standard deviation of the pixel-to-pixel difference in a flat patch: film grain shows up here, a smooth gradient does not. */
function grainStd(img, x0, y0, w, h) {
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w - 1; x += 1) {
      const i = (y * img.w + x) * 3;
      const d = luma(img.data, i + 3) - luma(img.data, i);
      sum += d;
      sum2 += d * d;
      n += 1;
    }
  }
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sum2 / n - mean * mean));
}

function describe(img) {
  const overall = patchStats(img, 0, 0, img.w, img.h);
  const corner = patchStats(img, 4, 4, 48, 48);
  const edgeMid = patchStats(img, 4, Math.floor(img.h * 0.4), 48, 48);
  const above = patchStats(img, Math.floor(img.w * 0.45), 4, 48, 48);
  let brightest = 0;
  for (let i = 0; i < img.data.length; i += 3) brightest = Math.max(brightest, luma(img.data, i));
  return { mean: overall.mean, corner: corner.mean, above: above.mean, edgeMid: edgeMid.mean, grain: grainStd(img, 4, 4, 48, 48), brightest };
}

async function main() {
  const [hwFile, swFile] = process.argv.slice(2);
  if (!hwFile || !swFile) throw new Error('usage: node parity.mjs <hardware.png> <software.png>');
  const [hw, sw] = await Promise.all([load(hwFile), load(swFile)]);
  if (hw.w !== sw.w || hw.h !== sw.h) throw new Error(`size mismatch ${hw.w}x${hw.h} vs ${sw.w}x${sw.h}`);

  const diffs = new Uint8Array(hw.w * hw.h);
  let sumAbs = 0;
  let big = 0;
  for (let p = 0; p < diffs.length; p += 1) {
    let worst = 0;
    for (let c = 0; c < 3; c += 1) {
      const d = Math.abs(hw.data[p * 3 + c] - sw.data[p * 3 + c]);
      sumAbs += d;
      if (d > worst) worst = d;
    }
    diffs[p] = worst;
    if (worst > 40) big += 1;
  }
  const hist = new Uint32Array(256);
  for (const d of diffs) hist[d] += 1;
  let acc = 0;
  let p99 = 0;
  for (let v = 0; v < 256; v += 1) {
    acc += hist[v];
    if (acc >= diffs.length * 0.99) {
      p99 = v;
      break;
    }
  }
  const meanAbs = sumAbs / (diffs.length * 3);
  const bigShare = big / diffs.length;
  const a = describe(hw);
  const b = describe(sw);
  const gradient = (d) => d.above - d.corner;

  const checks = [
    ['software frame is not black or blown out', b.mean > TOLERANCE.minMean && b.mean < TOLERANCE.maxMean, `mean luminance ${b.mean.toFixed(1)}`],
    ['mean difference', meanAbs <= TOLERANCE.meanAbs, `${meanAbs.toFixed(2)} (limit ${TOLERANCE.meanAbs})`],
    ['99th percentile difference', p99 <= TOLERANCE.p99, `${p99} (limit ${TOLERANCE.p99})`],
    ['pixels differing by > 40', bigShare <= TOLERANCE.bigShare, `${(bigShare * 100).toFixed(3)}% (limit ${TOLERANCE.bigShare * 100}%)`],
    ['backdrop gradient present', Math.abs(gradient(a) - gradient(b)) <= TOLERANCE.gradientDelta, `hardware ${gradient(a).toFixed(1)}, software ${gradient(b).toFixed(1)}`],
    ['film grain present', b.grain > 0.3 && b.grain / Math.max(a.grain, 1e-6) < TOLERANCE.grainRatio && a.grain / Math.max(b.grain, 1e-6) < TOLERANCE.grainRatio, `hardware ${a.grain.toFixed(2)}, software ${b.grain.toFixed(2)}`],
    ['OLED glow reaches full brightness', b.brightest > 200 && Math.abs(a.brightest - b.brightest) < 40, `hardware ${a.brightest.toFixed(0)}, software ${b.brightest.toFixed(0)}`],
  ];
  log(`hardware: ${hwFile}\nsoftware: ${swFile}  (${hw.w}x${hw.h})`);
  let failed = 0;
  for (const [name, ok, detail] of checks) {
    log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
    if (!ok) failed += 1;
  }
  log(failed ? `parity FAILED (${failed} checks)` : 'parity OK');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(2);
});
