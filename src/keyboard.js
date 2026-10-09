// Assembles the keyboard: case, switches, contribution keycaps, knob, OLED pod and the printed decals.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BRAND, capColor, contributionLevel } from './palette.js';
import { buildLayout, assignDays } from './layout.js';
import { keycapGeometry } from './keycap.js';
import { buildCaseGeometry, CASE } from './keyboardCase.js';
import { buildOled } from './oled.js';
import { oledModel } from './oledLayout.js';
import { makeBadge, makeLegend, decalMesh } from './decals.js';
import { buildKnob } from './knob.js';
import { buildTimeline, keyDepth, todayFlash, liveDot } from './timeline.js';

const HOUSING_H = 0.4;
const CAP_REST_GAP = 0.05; // air between switch housing and the bottom of an idle key's skirt
const MAX_LIFT = 0.4; // lift of the busiest key (about 0.65 of a keycap height)

const GLOW_REST = 0.35; // today's key: steady emissive level and its point light
const GLOW_PEAK = 1.7;
const LIGHT_REST = 0.6;
const LIGHT_PEAK = 3.2;

const BADGE_TEXT = 'Nobxx';
const BADGE_X = 3.3; // centre of the badge on the front lip
const LEGEND_X = 12.7; // mirror image of the badge about the case centre line (x = 8)
const LIP_OFFSET = 0.4; // lip centre line, measured from the pocket's front edge

const caseCentre = () => ({ x: (CASE.outer.x0 + CASE.outer.x1) / 2, z: (CASE.outer.z0 + CASE.outer.z1) / 2 });

function materials(theme) {
  return {
    shell: new THREE.MeshPhysicalMaterial({
      color: BRAND.pondNavy,
      metalness: 0.55,
      roughness: 0.5,
      clearcoat: 0.9,
      clearcoatRoughness: 0.28,
    }),
    bevel: new THREE.MeshPhysicalMaterial({
      color: '#46506A',
      metalness: 0.9,
      roughness: 0.2,
      clearcoat: 0.6,
      clearcoatRoughness: 0.15,
    }),
    floor: new THREE.MeshStandardMaterial({
      color: '#0d1018',
      roughness: 0.9,
      metalness: 0.1,
      emissive: new THREE.Color(BRAND.deepAmber),
      emissiveIntensity: theme.pocketGlow,
    }),
    housing: new THREE.MeshStandardMaterial({ color: '#171b27', roughness: 0.55, metalness: 0.2 }),
    pod: new THREE.MeshPhysicalMaterial({ color: '#2B3347', metalness: 0.7, roughness: 0.36, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
    bezel: new THREE.MeshStandardMaterial({ color: '#020203', roughness: 0.25, metalness: 0.0 }),
  };
}

function capMaterial(color, theme) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.46,
    metalness: 0,
    clearcoat: 0.18,
    clearcoatRoughness: 0.42,
    sheen: 0.3,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color(BRAND.cream),
    emissive: color.clone(),
    emissiveIntensity: theme.capEmissive,
  });
}

/**
 * @param {object} data parsed data.json
 * @param {object} theme entry of THEMES
 * @returns keyboard parts and animation handles
 */
export function buildKeyboard(data, theme) {
  const mats = materials(theme);
  const layout = buildLayout();
  const keys = assignDays(layout.keys, data.days);
  const maxCount = Math.max(...keys.map((k) => k.day?.count ?? 0), 1);

  const content = new THREE.Group(); // case-centred, un-tilted
  const c = caseCentre();
  content.position.set(-c.x, 0, -c.z);

  // case + key plate
  const caseMesh = new THREE.Mesh(buildCaseGeometry(), [mats.shell, mats.bevel, mats.floor]);
  caseMesh.castShadow = true;
  caseMesh.receiveShadow = true;
  content.add(caseMesh);

  // switches and caps. A raised key is one taller cap: its skirt hangs down to the same rest height as an idle key.
  const housingGeo = new RoundedBoxGeometry(0.66, HOUSING_H, 0.66, 3, 0.05);
  const housingTop = -CASE.pocketDepth + HOUSING_H;
  const housingOffsets = (w) => (w >= 6 ? [-2.6, 0, 2.6] : w >= 2 ? [-0.62, 0, 0.62] : [0]);

  const handles = [];
  const caps = new THREE.Group();
  content.add(caps);

  keys.forEach((key, index) => {
    const count = key.day?.count ?? 0;
    const lift = MAX_LIFT * contributionLevel(count, maxCount);
    const color = capColor(count, maxCount);
    const geo = keycapGeometry(key.w, key.row, lift);
    const mat = capMaterial(color, theme);
    const cap = new THREE.Mesh(geo, mat);
    const baseY = housingTop + CAP_REST_GAP + lift;
    cap.position.set(key.x, baseY, key.z);
    cap.castShadow = true;
    cap.receiveShadow = true;
    caps.add(cap);

    for (const dx of housingOffsets(key.w)) {
      const h = new THREE.Mesh(housingGeo, mats.housing);
      h.position.set(key.x + dx, -CASE.pocketDepth + HOUSING_H / 2, key.z);
      h.castShadow = true;
      h.receiveShadow = true;
      caps.add(h);
    }
    handles.push({ key, index, cap, mat, baseColor: color.clone(), baseY, lift, count, topY: baseY + geo.userData.topY });
  });
  const today = handles.find((h) => h.key.id === 'right');
  today.mat.emissive.set(BRAND.beakOrange);

  const timeline = buildTimeline(
    keys.map((k) => ({ x: k.x, z: k.z, count: k.day?.count ?? 0 })),
    maxCount,
  );

  const glow = new THREE.PointLight(BRAND.beakOrange, LIGHT_REST, 4, 2);
  glow.position.set(today.key.x, today.topY + 0.9, today.key.z + 0.2);
  content.add(glow);

  // rotary knob in the 16th column of the F-row
  const knob = buildKnob(-CASE.pocketDepth, mats);
  knob.position.set(layout.knob.x, 0, layout.knob.z);
  content.add(knob);

  // OLED pod
  const model = oledModel(data);
  const oled = buildOled(model, { podMaterial: mats.pod, bezelMaterial: mats.bezel, glowNits: theme.oledGlow });
  content.add(oled.group);

  // printed decals on the front lip: account badge on the left, colour legend on the right
  const lipZ = CASE.pocket.z1 + LIP_OFFSET;
  content.add(decalMesh(makeBadge(BADGE_TEXT), [BADGE_X, lipZ], 0.004, 0.86));
  content.add(decalMesh(makeLegend(), [LEGEND_X, lipZ], 0.004, 0.92));

  const tilt = new THREE.Group();
  tilt.rotation.x = (CASE.tiltDeg * Math.PI) / 180;
  tilt.add(content);
  const root = new THREE.Group();
  root.add(tilt);

  // sit the flat underside on the ground
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(caseMesh);
  root.position.y -= box.min.y;

  let lastLive = -1;
  /**
   * Pose everything for time t: key travel, today's glow and the OLED status dot.
   * @param {number} t seconds into the loop
   * @param {{blink?: boolean}} o blink: false keeps the status dot lit (still images)
   */
  function update(t, { blink = true } = {}) {
    handles.forEach((h) => {
      h.cap.position.y = h.baseY - keyDepth(timeline, h.index, t);
    });
    const flash = todayFlash(timeline, t);
    today.mat.emissiveIntensity = GLOW_REST + (GLOW_PEAK - GLOW_REST) * flash;
    glow.intensity = LIGHT_REST + (LIGHT_PEAK - LIGHT_REST) * flash;
    const live = blink ? liveDot(timeline, t) : 1;
    if (live !== lastLive) {
      oled.screen.draw(live);
      lastLive = live;
    }
  }

  return { root, tilt, content, keys: handles, today, oled, model, maxCount, caseMesh, mats, timeline, update, knob };
}
