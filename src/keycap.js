// Parametric keycap: tapered walls, filleted top edge, cylindrical dish, per-row tilt.
import * as THREE from 'three';
import { Loft, lerp, clamp01, smoothstep } from './loft.js';

export const CAP = {
  gap: 0.095, // slot minus base width
  taper: 0.125, // horizontal inset of the wall by the top edge
  fillet: 0.1, // radius of the rounded top edge
  baseRadius: 0.17,
  topRadius: 0.1,
  dishZ: 0.05, // depth of the front-to-back dish
  dishX: 0.012, // tiny side-to-side curvature
  seg: 8,
  arcSteps: 9,
};

/** Cherry-ish sculpted rows: [capHeight, tiltDegrees] (positive tilt = back edge higher). */
export const ROW_PROFILE = [
  [0.62, 10],
  [0.64, 8],
  [0.6, 4],
  [0.58, 0],
  [0.58, -4],
  [0.6, -8],
];

/** Side profile: wall from the base up to a virtual corner, replaced by a circular fillet. */
function sideProfile(height, cfg) {
  const { taper, fillet, arcSteps } = cfg;
  const len = Math.hypot(taper, height);
  const d1 = [taper / len, height / len];
  const tangent = (fillet * (1 - d1[0])) / d1[1];
  const t1 = [taper - d1[0] * tangent, height - d1[1] * tangent];
  const centre = [t1[0] + d1[1] * fillet, t1[1] - d1[0] * fillet];
  const a1 = Math.atan2(t1[1] - centre[1], t1[0] - centre[0]);
  const a2 = Math.PI / 2;

  const wall = [
    { inset: 0, y: 0, stage: 'wall' },
    { inset: lerp(0, t1[0], 0.5), y: lerp(0, t1[1], 0.5), stage: 'wall' },
    { inset: t1[0], y: t1[1], stage: 'wall' },
  ];
  const arc = [];
  for (let i = 1; i <= arcSteps; i += 1) {
    const f = i / arcSteps;
    const a = lerp(a1, a2, f);
    arc.push({
      inset: centre[0] + fillet * Math.cos(a),
      y: centre[1] + fillet * Math.sin(a),
      stage: 'arc',
      f,
    });
  }
  return { points: [...wall, ...arc], insetTop: centre[0] };
}

/**
 * @param {object} o
 * @param {number} o.width key width in units (1 = 19.05 mm)
 * @param {number} [o.height] cap height at its centre line
 * @param {number} [o.tiltDeg] top-surface tilt, back edge higher when positive
 * @param {number} [o.skirt] straight skirt hanging below the base ring, so a raised key reads as one taller cap
 * @returns {THREE.BufferGeometry} base ring at y = 0, skirt below it, centred on x/z; `userData.topY` is the dish centre height
 */
export function buildKeycapGeometry({ width = 1, height = 0.6, tiltDeg = 0, skirt = 0, cfg = CAP }) {
  const hx = width / 2 - cfg.gap / 2;
  const hz = 0.5 - cfg.gap / 2;
  const tilt = Math.tan((tiltDeg * Math.PI) / 180);
  const { points, insetTop } = sideProfile(height, cfg);
  const a = hx - insetTop; // half extents of the flat top before the dish
  const b = hz - insetTop;

  const dishAt = (x, z) => {
    const zz = clamp01(Math.abs(z) / b);
    const xx = clamp01(Math.abs(x) / a);
    return cfg.dishZ * (1 - zz * zz) + cfg.dishX * (1 - xx * xx);
  };

  const loft = new Loft(cfg.seg);
  const skirtRing = skirt > 0 ? loft.ring({ hx, hz, r: cfg.baseRadius }, () => -skirt) : null;
  const firstRing = [];
  for (const p of points) {
    const radius = lerp(cfg.baseRadius, cfg.topRadius, clamp01(p.inset / insetTop));
    const wTilt = clamp01(p.y / height);
    const wDish = p.stage === 'arc' ? smoothstep(p.f) : 0;
    firstRing.push(
      loft.ring({ hx: hx - p.inset, hz: hz - p.inset, r: radius }, (x, z) => p.y - tilt * z * wTilt - wDish * dishAt(x, z)),
    );
  }
  if (skirtRing !== null) loft.band(skirtRing, firstRing[0]);
  for (let i = 0; i < firstRing.length - 1; i += 1) loft.band(firstRing[i], firstRing[i + 1]);

  const topY = (x, z) => height - tilt * z - dishAt(x, z);
  let prev = firstRing[firstRing.length - 1];
  for (const k of [0.82, 0.64, 0.46, 0.3, 0.17, 0.07]) {
    const r = loft.ring({ hx: a * k, hz: b * k, r: cfg.topRadius * k }, topY);
    loft.band(prev, r);
    prev = r;
  }
  loft.cap(prev, [0, topY(0, 0), 0], true);
  if (skirtRing !== null) loft.cap(skirtRing, [0, -skirt, 0], false);
  else loft.cap(firstRing[0], [0, 0, 0], false);

  const geo = loft.build();
  geo.userData.topY = topY(0, 0);
  geo.userData.height = height;
  geo.userData.skirt = skirt;
  return geo;
}

const cache = new Map();
/** Geometry cache: keys of equal width, row and skirt height share one mesh. */
export function keycapGeometry(width, row, skirt = 0) {
  const key = `${width}|${row}|${skirt.toFixed(3)}`;
  if (!cache.has(key)) {
    const [height, tiltDeg] = ROW_PROFILE[row];
    cache.set(key, buildKeycapGeometry({ width, height, tiltDeg, skirt }));
  }
  return cache.get(key);
}
