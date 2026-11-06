// Small lofting toolkit: stacks of rounded-rectangle rings joined into one smooth mesh.
// Used for keycaps, the aluminium case and the OLED pod, so every surface has real
// rounded edges instead of boxy primitives.
import * as THREE from 'three';

/** Outline of a rounded rectangle, `4 * (seg + 1)` points, walking +x -> +z around the centre. */
export function roundedRectOutline(cx, cz, hx, hz, r, seg) {
  const rad = Math.max(0.0005, Math.min(r, hx, hz));
  const corners = [
    [hx - rad, hz - rad, 0],
    [-(hx - rad), hz - rad, Math.PI / 2],
    [-(hx - rad), -(hz - rad), Math.PI],
    [hx - rad, -(hz - rad), Math.PI * 1.5],
  ];
  const pts = [];
  for (const [ox, oz, a0] of corners) {
    for (let i = 0; i <= seg; i += 1) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      pts.push([cx + ox + rad * Math.cos(a), cz + oz + rad * Math.sin(a)]);
    }
  }
  return pts;
}

export class Loft {
  /** @param {number} seg segments per rounded corner (all rings must share it) */
  constructor(seg) {
    this.seg = seg;
    this.n = 4 * (seg + 1);
    this.positions = [];
    this.parts = []; // {indices:number[], material:number}
    this.rings = 0;
  }

  /**
   * Add a ring built from a rounded-rect outline. `yAt(x, z)` gives the height of each point.
   * @returns {number} ring index
   */
  ring({ cx = 0, cz = 0, hx, hz, r }, yAt) {
    for (const [x, z] of roundedRectOutline(cx, cz, hx, hz, r, this.seg)) {
      this.positions.push(x, yAt(x, z), z);
    }
    this.rings += 1;
    return this.rings - 1;
  }

  /** Connect ring `a` to ring `b` with outward-facing quads (outward = away from the loft axis, or up on top faces). */
  band(a, b, material = 0) {
    const { n } = this;
    const idx = [];
    for (let j = 0; j < n; j += 1) {
      const j2 = (j + 1) % n;
      const ra = a * n;
      const rb = b * n;
      idx.push(ra + j, rb + j, ra + j2, ra + j2, rb + j, rb + j2);
    }
    this.parts.push({ indices: idx, material });
  }

  /** Close a ring with a triangle fan. `up` selects which way the face points. */
  cap(ringIndex, centre, up, material = 0) {
    const { n } = this;
    const c = this.positions.length / 3;
    this.positions.push(centre[0], centre[1], centre[2]);
    const idx = [];
    for (let j = 0; j < n; j += 1) {
      const p = ringIndex * n + j;
      const q = ringIndex * n + ((j + 1) % n);
      if (up) idx.push(c, q, p);
      else idx.push(c, p, q);
    }
    this.parts.push({ indices: idx, material });
  }

  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    const all = [];
    let start = 0;
    for (const part of this.parts) {
      all.push(...part.indices);
      geo.addGroup(start, part.indices.length, part.material);
      start += part.indices.length;
    }
    geo.setIndex(all);
    geo.computeVertexNormals();
    return geo;
  }
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = (v) => Math.min(1, Math.max(0, v));
export const smoothstep = (t) => t * t * (3 - 2 * t);
