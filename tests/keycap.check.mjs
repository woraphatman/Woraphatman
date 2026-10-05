import assert from 'node:assert/strict';
import { buildKeycapGeometry, keycapGeometry } from '../src/keycap.js';

const stats = (geo) => {
  geo.computeBoundingBox();
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  let nan = 0;
  for (let i = 0; i < pos.count; i += 1) for (const a of [pos, nor]) if (!Number.isFinite(a.getX(i) + a.getY(i) + a.getZ(i))) nan += 1;
  return { pos, nor, bb: geo.boundingBox, nan };
};
const round = (v) => Math.round(v * 1e4) / 1e4;
const ringPoints = (pos, y) => {
  const pts = new Set();
  for (let i = 0; i < pos.count; i += 1) if (Math.abs(pos.getY(i) - y) < 1e-6 && (pos.getX(i) !== 0 || pos.getZ(i) !== 0)) pts.add(`${round(pos.getX(i))},${round(pos.getZ(i))}`);
  return [...pts].sort();
};

// plain cap
const geo = buildKeycapGeometry({ width: 1, height: 0.6, tiltDeg: 0 });
const { pos, nor, bb, nan } = stats(geo);
assert.equal(nan, 0, 'NaN in positions or normals');
assert.ok(Math.abs(bb.min.y) < 1e-6, 'base ring sits at y = 0');
assert.ok(Math.abs(bb.max.x - 0.4525) < 1e-3 && Math.abs(bb.max.z - 0.4525) < 1e-3, `footprint ${bb.max.x}`); // 1u minus the 0.095 gap, halved
assert.ok(geo.userData.topY < 0.6 && geo.userData.topY > 0.5, `dish centre height ${geo.userData.topY}`);

// wall normals point away from the centre
let walls = 0;
let inward = 0;
for (let i = 0; i < pos.count; i += 1) {
  const y = pos.getY(i);
  if (y > 0.2 && y < 0.5) {
    walls += 1;
    if (nor.getX(i) * pos.getX(i) + nor.getZ(i) * pos.getZ(i) < 0) inward += 1;
  }
}
assert.ok(walls > 0, 'found wall vertices');
assert.equal(inward, 0, 'inward-facing wall normals');

// the top-centre vertex faces up
let best = -1;
let bestY = -1e9;
for (let i = 0; i < pos.count; i += 1) if (Math.abs(pos.getX(i)) < 1e-6 && Math.abs(pos.getZ(i)) < 1e-6 && pos.getY(i) > bestY) [best, bestY] = [i, pos.getY(i)];
assert.ok(nor.getY(best) > 0.99, `top normal ${nor.getY(best)}`);

// skirt: a straight vertical extension below the base ring, same footprint, nothing else changes
const skirt = 0.3;
const tall = buildKeycapGeometry({ width: 1, height: 0.6, tiltDeg: 0, skirt });
const t = stats(tall);
assert.equal(t.nan, 0);
assert.ok(Math.abs(t.bb.min.y + skirt) < 1e-6, `skirt bottom ${t.bb.min.y}`);
assert.ok(Math.abs(t.bb.max.y - bb.max.y) < 1e-6, 'the top does not move');
assert.deepEqual(ringPoints(t.pos, -skirt), ringPoints(t.pos, 0), 'skirt ring has the same outline as the base ring');
assert.deepEqual(ringPoints(t.pos, 0), ringPoints(pos, 0), 'base ring unchanged');
assert.equal(tall.userData.topY, geo.userData.topY);
// the skirt is one straight band between two rings: no vertices between them, and the ring vertices lean outward
const between = [...Array(t.pos.count).keys()].filter((i) => t.pos.getY(i) > -skirt + 1e-6 && t.pos.getY(i) < -1e-6);
assert.equal(between.length, 0, 'vertices between the skirt rings');
const ring = [...Array(t.pos.count).keys()].filter((i) => Math.abs(t.pos.getY(i) + skirt) < 1e-6 && (t.pos.getX(i) !== 0 || t.pos.getZ(i) !== 0));
assert.ok(ring.length > 20, 'skirt ring found');
assert.ok(ring.every((i) => t.nor.getX(i) * t.pos.getX(i) + t.nor.getZ(i) * t.pos.getZ(i) > 0), 'skirt ring normals lean outward');
const bottomFacing = [...Array(t.pos.count).keys()].filter((i) => Math.abs(t.pos.getY(i) + skirt) < 1e-6 && t.pos.getX(i) === 0 && t.pos.getZ(i) === 0);
assert.equal(bottomFacing.length, 1);
assert.ok(t.nor.getY(bottomFacing[0]) < -0.5, 'the underside faces down');

// cache: same width/row/skirt share one geometry, a different skirt does not
assert.equal(keycapGeometry(1, 2, 0.2), keycapGeometry(1, 2, 0.2));
assert.notEqual(keycapGeometry(1, 2, 0.2), keycapGeometry(1, 2, 0.21));

process.stdout.write(`keycap ok: ${pos.count} verts plain, ${t.pos.count} with skirt, top normal ${nor.getY(best).toFixed(3)}\n`);
