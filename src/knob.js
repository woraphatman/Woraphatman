// Rotary knob for the 16th column of the F-row: knurled anodised aluminium on a dark encoder body.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { BRAND } from './palette.js';

const FLUTES = 28;
const FLUTE_DEPTH = 0.016;

function knobGeometry() {
  const profile = [
    [0, 0],
    [0.4, 0],
    [0.42, 0.02],
    [0.42, 0.3],
    [0.395, 0.4],
    [0.34, 0.44],
    [0.26, 0.44],
    [0.2, 0.43],
    [0, 0.415],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  let geo = new THREE.LatheGeometry(profile, 144);
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  geo = mergeVertices(geo, 1e-5);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i += 1) {
    const y = p.getY(i);
    if (y < 0.05 || y > 0.31) continue;
    const theta = Math.atan2(p.getZ(i), p.getX(i));
    const k = 1 + FLUTE_DEPTH * Math.cos(FLUTES * theta);
    p.setXYZ(i, p.getX(i) * k, y, p.getZ(i) * k);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * @param {number} floorY y of the pocket floor, where the encoder body starts
 * @param {{housing: THREE.Material}} mats
 * @returns {THREE.Group} origin at the knob's centre, the knob's base at y = 0 (the key-plate rim)
 */
export function buildKnob(floorY, { housing }) {
  const group = new THREE.Group();
  const metal = new THREE.MeshPhysicalMaterial({
    color: BRAND.deepAmber,
    metalness: 0.92,
    roughness: 0.3,
    clearcoat: 0.3,
    clearcoatRoughness: 0.25,
  });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, -floorY, 48), housing);
  body.position.y = floorY / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const knob = new THREE.Mesh(knobGeometry(), metal);
  knob.position.y = 0.01;
  knob.castShadow = true;
  knob.receiveShadow = true;
  group.add(knob);

  const mark = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.014, 0.17),
    new THREE.MeshStandardMaterial({ color: '#242A38', roughness: 0.5 }),
  );
  const angle = 0.55; // indicator points back and slightly left of the typist
  mark.rotation.y = angle;
  mark.position.set(-0.17 * Math.sin(angle), 0.434, -0.17 * Math.cos(angle));
  knob.add(mark);
  return group;
}
