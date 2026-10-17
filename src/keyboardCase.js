// Aluminium case: a wedge with a flat underside, a rounded top edge and a recessed key pocket.
// Local frame: y up, +z towards the typist, key area spans x 0..16 and z 0..6, rim top at y = 0.
import * as THREE from 'three';
import { Loft, lerp } from './loft.js';

export const CASE = {
  outer: { x0: -0.65, x1: 16.65, z0: -2.56, z1: 7.1 },
  pocket: { x0: -0.12, x1: 16.12, z0: -0.14, z1: 6.14 },
  outerRadius: 0.62,
  pocketRadius: 0.14,
  bottomFillet: 0.26,
  topFillet: 0.24,
  pocketFillet: 0.07,
  pocketDepth: 0.42,
  frontThickness: 0.62,
  tiltDeg: 6.5,
  seg: 12,
};

const rect = ({ x0, x1, z0, z1 }) => ({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2 });
const rad = (d) => (d * Math.PI) / 180;

/** Material groups: 0 shell, 1 polished bevel, 2 pocket floor. */
export function buildCaseGeometry(cfg = CASE) {
  const O = rect(cfg.outer);
  const P = rect(cfg.pocket);
  const slope = Math.tan(rad(cfg.tiltDeg));
  const thickness = (z) => cfg.frontThickness + (cfg.outer.z1 - z) * slope;
  const loft = new Loft(cfg.seg);

  const ringAt = (base, grow, r, yAt) => loft.ring({ cx: base.cx, cz: base.cz, hx: base.hx + grow, hz: base.hz + grow, r }, yAt);
  const quarter = (steps) => Array.from({ length: steps }, (_, i) => ((i + 1) / steps) * (Math.PI / 2));

  // bottom face and its fillet
  const bottom = ringAt(O, -cfg.bottomFillet, cfg.outerRadius - cfg.bottomFillet, (x, z) => -thickness(z));
  let prev = bottom;
  const rings = { bottom };
  for (const phi of quarter(6)) {
    const inset = cfg.bottomFillet * (1 - Math.sin(phi));
    const lift = cfg.bottomFillet * (1 - Math.cos(phi));
    const r = ringAt(O, -inset, cfg.outerRadius - inset, (x, z) => -thickness(z) + lift);
    loft.band(prev, r, 0);
    prev = r;
  }
  // wall
  const wallMid = ringAt(O, 0, cfg.outerRadius, (x, z) => lerp(-thickness(z) + cfg.bottomFillet, -cfg.topFillet, 0.5));
  loft.band(prev, wallMid, 0);
  const wallTop = ringAt(O, 0, cfg.outerRadius, () => -cfg.topFillet);
  loft.band(wallMid, wallTop, 0);
  prev = wallTop;
  // top fillet (polished bevel)
  for (const phi of quarter(9)) {
    const inset = cfg.topFillet * (1 - Math.cos(phi));
    const y = -cfg.topFillet + cfg.topFillet * Math.sin(phi);
    const r = ringAt(O, -inset, cfg.outerRadius - inset, () => y);
    loft.band(prev, r, 1);
    prev = r;
  }
  // flat rim to the pocket edge
  const rimIn = ringAt(P, cfg.pocketFillet, cfg.pocketRadius + cfg.pocketFillet, () => 0);
  loft.band(prev, rimIn, 0);
  prev = rimIn;
  // pocket edge fillet (polished)
  for (const phi of quarter(5)) {
    const e = cfg.pocketFillet * (1 - Math.sin(phi));
    const y = -cfg.pocketFillet * (1 - Math.cos(phi));
    const r = ringAt(P, e, cfg.pocketRadius + e, () => y);
    loft.band(prev, r, 1);
    prev = r;
  }
  // pocket wall and floor
  const floor = ringAt(P, 0, cfg.pocketRadius, () => -cfg.pocketDepth);
  loft.band(prev, floor, 0);
  loft.cap(floor, [P.cx, -cfg.pocketDepth, P.cz], true, 2);
  loft.cap(rings.bottom, [O.cx, -thickness(O.cz), O.cz], false, 0);

  const geo = loft.build();
  geo.userData.thickness = thickness;
  return geo;
}

/** Plan-view footprint of the case bottom, used to size the contact shadow. */
export const caseFootprint = () => {
  const O = rect(CASE.outer);
  return { width: O.hx * 2, depth: O.hz * 2, cx: O.cx, cz: O.cz };
};
