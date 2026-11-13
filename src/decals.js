// Printed decals for the case's front lip: the account badge and the "less ... more" legend.
// Lettering is stroked from vector paths instead of a system font, so renders look the same on any machine
// (a CI runner has no Segoe UI). Coordinates are in em units: x right, y up from the baseline, x-height 0.54.
import * as THREE from 'three';
import { BRAND, legendColors } from './palette.js';

export const PX_PER_UNIT = 400; // texture pixels per world unit

const O = (cx, cy, r) => ['O', cx, cy, r]; // full circle
const A = (cx, cy, r, from, to) => ['A', cx, cy, r, from, to]; // arc in degrees, counter-clockwise when to > from
const M = (x, y) => ['M', x, y];
const L = (x, y) => ['L', x, y];

const GLYPHS = {
  N: { adv: 0.74, paths: [[M(0.06, 0), L(0.06, 0.72), L(0.62, 0), L(0.62, 0.72)]] },
  o: { adv: 0.66, paths: [[O(0.32, 0.27, 0.27)]] },
  b: { adv: 0.68, paths: [[M(0.06, 0.8), L(0.06, 0)], [O(0.33, 0.27, 0.27)]] },
  x: { adv: 0.6, paths: [[M(0.04, 0.54), L(0.56, 0)], [M(0.04, 0), L(0.56, 0.54)]] },
  l: { adv: 0.18, paths: [[M(0.06, 0.8), L(0.06, 0)]] },
  e: { adv: 0.64, paths: [[M(0.05, 0.27), L(0.59, 0.27), A(0.32, 0.27, 0.27, 0, 320)]] },
  s: { adv: 0.52, paths: [[A(0.25, 0.405, 0.135, 30, 270), A(0.25, 0.135, 0.135, 90, -150)]] },
  m: {
    adv: 0.78,
    paths: [[M(0.06, 0.54), L(0.06, 0)], [M(0.06, 0.39), A(0.21, 0.39, 0.15, 180, 0), L(0.36, 0)], [M(0.36, 0.39), A(0.51, 0.39, 0.15, 180, 0), L(0.66, 0)]],
  },
  r: { adv: 0.4, paths: [[M(0.06, 0.54), L(0.06, 0)], [M(0.06, 0.38), A(0.22, 0.38, 0.16, 180, 40)]] },
};

const rad = (deg) => (deg * Math.PI) / 180;

export const wordAdvance = (word, tracking) => [...word].reduce((sum, ch) => sum + GLYPHS[ch].adv, 0) + tracking * (word.length - 1);

function strokeGlyph(ctx, glyph, ox, oy, em) {
  const px = (x) => ox + x * em;
  const py = (y) => oy - y * em;
  for (const path of glyph.paths) {
    ctx.beginPath();
    for (const [op, a, b, c, d, e] of path) {
      if (op === 'M') ctx.moveTo(px(a), py(b));
      else if (op === 'L') ctx.lineTo(px(a), py(b));
      else if (op === 'O') {
        ctx.moveTo(px(a + c), py(b));
        ctx.arc(px(a), py(b), c * em, 0, Math.PI * 2);
      } else ctx.arc(px(a), py(b), c * em, -rad(d), -rad(e), e > d);
    }
    ctx.stroke();
  }
}

/** Draw `word` with its baseline at y and its left edge at x (canvas pixels). Returns the drawn width. */
export function drawWord(ctx, word, x, y, em, tracking) {
  ctx.lineWidth = em * 0.105;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  let cx = x;
  for (const ch of word) {
    strokeGlyph(ctx, GLYPHS[ch], cx, y, em);
    cx += (GLYPHS[ch].adv + tracking) * em;
  }
  return wordAdvance(word, tracking) * em;
}

function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.round(w * PX_PER_UNIT);
  c.height = Math.round(h * PX_PER_UNIT);
  return c;
}

function toTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  return tex;
}

/** @returns {{canvas: HTMLCanvasElement, texture: THREE.Texture, width: number, height: number}} sizes in world units */
export function makeBadge(text, { width = 2.4, height = 0.5, em = 0.3, tracking = 0.42 } = {}) {
  const canvas = newCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = BRAND.cream;
  const emPx = em * PX_PER_UNIT;
  const w = wordAdvance(text, tracking) * emPx;
  drawWord(ctx, text, (canvas.width - w) / 2, canvas.height / 2 + 0.4 * emPx, emPx, tracking);
  return { canvas, texture: toTexture(canvas), width, height };
}

export function makeLegend({ width = 3.4, height = 0.5, em = 0.2, tracking = 0.2, swatch = 0.24, gap = 0.08, pad = 0.2 } = {}) {
  const canvas = newCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const u = PX_PER_UNIT;
  const emPx = em * u;
  const sw = swatch * u;
  const colors = legendColors();
  const less = wordAdvance('less', tracking) * emPx;
  const more = wordAdvance('more', tracking) * emPx;
  const strip = colors.length * sw + (colors.length - 1) * gap * u;
  const total = less + pad * u + strip + pad * u + more;
  let x = (canvas.width - total) / 2;
  const mid = canvas.height / 2;

  ctx.strokeStyle = BRAND.cream;
  drawWord(ctx, 'less', x, mid + 0.4 * emPx, emPx, tracking);
  x += less + pad * u;
  colors.forEach((color) => {
    ctx.fillStyle = color.getStyle();
    ctx.beginPath();
    ctx.roundRect(x, mid - sw / 2, sw, sw, sw * 0.2);
    ctx.fill();
    x += sw + gap * u;
  });
  x += pad * u - gap * u;
  drawWord(ctx, 'more', x, mid + 0.4 * emPx, emPx, tracking);
  return { canvas, texture: toTexture(canvas), width, height };
}

/** A lit, slightly translucent print lying on the case lip. `centre` is [x, z] in the case frame. */
export function decalMesh({ texture, width, height }, centre, y, opacity) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshStandardMaterial({ map: texture, transparent: true, opacity, roughness: 0.4, metalness: 0, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(centre[0], y, centre[1]);
  mesh.receiveShadow = true;
  return mesh;
}
