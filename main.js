// GitHub profile banner: a 3D keyboard whose keys are the contribution calendar.
//   index.html                live, animated: the keys press down lightest -> darkest, spring back, today's key flashes; drag to spin the view
//                             (no &theme: follows the visitor's light/dark setting)
//   index.html?still=1        progressive-accumulation still; sets window.__ready when the frame is final.
//                             Pose = the calm end of the loop, or the exact frame at &t=<seconds into the loop>.
//   &theme=day|night          &view=hero|keys|oled  camera preset     &samples=N  accumulation samples     &pr=N  pixel ratio
//   &profile=ci               cost preset for GPU-less CI runners (fewer samples, smaller shadow map); &shadow=N overrides the shadow map size
//   window.__renderAt(t)      (still mode) re-render the frame at time t without reloading; used by capture-anim.mjs
//   window.__poseKeyAt(t)     (still mode) fingerprint of the frame at time t; equal fingerprints render identical frames
import * as THREE from 'three';
import { buildKeyboard } from './src/keyboard.js';
import { buildEnvironment, buildGround, buildLights, buildUnderglow, SHADOW_HALF_EXTENT, SHADOW_RADIUS } from './src/stage.js';
import { Pipeline } from './src/post.js';
import { VIEWS, placeCamera, halton, jitterCamera } from './src/camera.js';
import { themeById } from './src/theme.js';
import { poseKey, restTime } from './src/timeline.js';
import { attachOrbit } from './src/orbit.js';

const params = new URLSearchParams(location.search);
const STILL = params.get('still') === '1';
const THEME = themeById(params.get('theme') ?? (!STILL && matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'day')); // the live page follows the visitor's colour scheme
const VIEW = VIEWS[params.get('view')] ?? VIEWS.hero;
const num = (key, fallback) => (params.has(key) ? Number(params.get(key)) : fallback);

// Cost presets. Light samples come in cycles of CYCLE: keyPerCycle tight key-light samples and the rest soft sky-dome
// samples. The per-sample intensity compensation (1 / share) only averages out to the right brightness over whole cycles,
// so `samples` must be a multiple of CYCLE. domeBlur widens the PCF filter of the dome samples' shadows on the desk (world
// units, 0 = off): with few samples the stepped copies of a soft shadow melt into one gradient.
const CYCLE = 8;
const PROFILES = {
  default: { samples: 160, shadowMap: 4096, keyPerCycle: 5, domeBlur: 0 },
  ci: { samples: 32, shadowMap: 1024, keyPerCycle: 3, domeBlur: 0.16 },
};
const PROFILE = PROFILES[params.get('profile')] ?? PROFILES.default;
const SAMPLES = num('samples', PROFILE.samples);
const SHADOW_MAP = num('shadow', PROFILE.shadowMap);
const KEY_PER_CYCLE = num('keys', PROFILE.keyPerCycle);
const DOME_BLUR = num('domeblur', PROFILE.domeBlur);
const PIXEL_RATIO = Number(params.get('pr') ?? Math.min(window.devicePixelRatio || 1, STILL ? 3 : 2));
const TUNE = { // quick look-dev overrides, e.g. &exp=0.8&bloom=0.3&ap=0&env=0.5&key=2&grain=0.5
  exposure: num('exp', THEME.exposure),
  bloom: num('bloom', 0),
  aperture: num('ap', VIEW.aperture ?? 0),
  env: num('env', THEME.env.intensity),
  key: num('key', THEME.key.intensity),
  dome: num('dome', THEME.dome.intensity),
  grain: num('grain', THEME.backdrop.grain * 255) / 255, // in 1/255 steps
};

const KEY_SAMPLE_SHARE = KEY_PER_CYCLE / CYCLE; // share of accumulation samples that use the tight key light (rest = soft sky dome)
const KEY_DIR = new THREE.Vector3(-0.62, 0.78, 0.3).normalize();
const KEY_SOFTNESS = Math.tan((7 * Math.PI) / 180);
const LIGHT_DISTANCE = 34;

async function loadData() {
  const res = await fetch('data.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`data.json: ${res.status}`);
  return res.json();
}

function createRenderer() {
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: STILL,
  });
  renderer.setPixelRatio(PIXEL_RATIO);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping; // applied in the final composite pass (see src/post.js)
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.body.appendChild(renderer.domElement);
  return renderer;
}

function buildScene(renderer, data) {
  const scene = new THREE.Scene();
  scene.environment = buildEnvironment(renderer, THEME.env.boxes);
  scene.environmentIntensity = TUNE.env;
  scene.environmentRotation.y = 0.35;

  const keyboard = buildKeyboard(data, THEME);
  scene.add(keyboard.root);

  const box = new THREE.Box3().setFromObject(keyboard.caseMesh);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const footprint = { width: size.x - 0.5, depth: size.z - 0.4, cx: centre.x, cz: centre.z };
  const ground = buildGround(footprint, THEME);
  scene.add(ground.group);

  const { sun } = buildLights(scene, THEME, { shadowMap: SHADOW_MAP });
  const underglow = buildUnderglow(footprint, THEME);
  if (underglow) scene.add(underglow);
  return { scene, keyboard, ground, sun, box };
}

/** A one-line hint at the bottom of the live page; returns the function that fades it out. */
function showHint() {
  const hint = document.createElement('p');
  hint.textContent = 'Drag to spin · double-click to reset';
  Object.assign(hint.style, {
    position: 'fixed', left: 0, right: 0, bottom: '14px', margin: 0, textAlign: 'center', pointerEvents: 'none', transition: 'opacity 0.6s',
    font: '13px/1.4 system-ui, sans-serif', letterSpacing: '0.02em', color: THEME.id === 'night' ? 'rgba(230,237,243,0.62)' : 'rgba(35,28,16,0.55)',
  });
  document.body.appendChild(hint);
  return () => {
    hint.style.opacity = '0';
    setTimeout(() => hint.remove(), 700);
  };
}

function liveLoop(ctx, renderer, pipeline, camera, t0) {
  const hideHint = showHint();
  setTimeout(hideHint, 7000);
  const orbit = attachOrbit(renderer.domElement, hideHint);
  let last = t0;
  renderer.setAnimationLoop((now) => {
    const t = (now - t0) / 1000;
    orbit.update((now - last) / 1000);
    last = now;
    ctx.keyboard.update(t);
    placeCamera(camera, VIEW, window.innerWidth / window.innerHeight, {
      az: 2.2 * Math.sin(t * 0.17) + orbit.state.az,
      el: 0.8 * Math.sin(t * 0.11 + 1.2) + orbit.state.el,
      dist: 0.25 * Math.sin(t * 0.09),
    });
    ctx.sun.position.copy(KEY_DIR).multiplyScalar(LIGHT_DISTANCE);
    ctx.sun.target.position.set(0, 0, 0);
    ctx.sun.color.set(THEME.key.color);
    ctx.sun.intensity = TUNE.key;
    pipeline.setCamera(camera);
    pipeline.renderLive(ctx.scene, camera, Math.floor(now / 16));
  });
}

/** Jitter the sun between a tight key light and a wide soft dome, so accumulated shadows get real penumbrae and contact occlusion. */
function sampleLights(ctx, i) {
  const slot = i % CYCLE;
  const isKey = slot < KEY_PER_CYCLE;
  const cycle = Math.floor(i / CYCLE);
  const k = isKey ? cycle * KEY_PER_CYCLE + slot : cycle * (CYCLE - KEY_PER_CYCLE) + slot - KEY_PER_CYCLE;
  const u1 = halton(k, 2);
  const u2 = halton(k, 3);
  const dir = new THREE.Vector3();
  let intensity;
  let opacity;
  let colour;
  if (isKey) {
    const e1 = new THREE.Vector3().crossVectors(KEY_DIR, new THREE.Vector3(0, 1, 0)).normalize();
    const e2 = new THREE.Vector3().crossVectors(KEY_DIR, e1).normalize();
    const r = KEY_SOFTNESS * Math.sqrt(u1);
    const a = 2 * Math.PI * u2;
    dir.copy(KEY_DIR).addScaledVector(e1, r * Math.cos(a)).addScaledVector(e2, r * Math.sin(a)).normalize();
    intensity = TUNE.key / KEY_SAMPLE_SHARE;
    opacity = THEME.key.shadow / KEY_SAMPLE_SHARE;
    colour = THEME.key.color;
  } else {
    const maxZenith = Math.sin((72 * Math.PI) / 180);
    const s = Math.sqrt(u1) * maxZenith;
    const phi = 2 * Math.PI * u2;
    dir.set(s * Math.cos(phi), Math.sqrt(1 - s * s), s * Math.sin(phi));
    intensity = TUNE.dome / (1 - KEY_SAMPLE_SHARE);
    opacity = THEME.dome.shadow / (1 - KEY_SAMPLE_SHARE);
    colour = THEME.dome.color;
  }
  ctx.sun.position.copy(dir).multiplyScalar(LIGHT_DISTANCE);
  ctx.sun.target.position.set(0, 0, 0);
  ctx.sun.intensity = intensity;
  ctx.sun.color.set(colour);
  ctx.ground.shadowMat.opacity = Math.min(opacity, 1);
  const texel = (2 * SHADOW_HALF_EXTENT) / SHADOW_MAP; // world units
  ctx.ground.shadowBlur.value = isKey || DOME_BLUR === 0 ? 1 : Math.max(1, DOME_BLUR / texel / SHADOW_RADIUS);
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

/**
 * Render one final frame by accumulating SAMPLES jittered renders (sub-pixel AA, lens DOF, soft sun).
 * @param {number} t seconds into the animation loop
 * @param {boolean} blink whether the OLED status dot follows the loop (false = lit)
 */
async function renderStill(ctx, renderer, pipeline, camera, t, blink) {
  const t0 = performance.now();
  const aspect = window.innerWidth / window.innerHeight;
  placeCamera(camera, VIEW, aspect);
  ctx.keyboard.update(t, { blink });

  const base = {
    projection: camera.projectionMatrix.clone(),
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
  };
  const focus = new THREE.Vector3(...VIEW.target);
  const focusDist = camera.position.distanceTo(focus);
  const { width, height } = renderer.getDrawingBufferSize(new THREE.Vector2());

  pipeline.beginAccumulation();
  const weight = 1 / SAMPLES;
  for (let i = 0; i < SAMPLES; i += 1) {
    sampleLights(ctx, i);
    const a = 2 * Math.PI * halton(i, 5);
    const r = Math.sqrt(halton(i, 7));
    jitterCamera(camera, base, {
      px: halton(i, 2) - 0.5,
      py: halton(i, 3) - 0.5,
      lensX: r * Math.cos(a),
      lensY: r * Math.sin(a),
      aperture: TUNE.aperture,
      focusDist,
      width,
      height,
    });
    pipeline.accumulate(ctx.scene, camera, weight);
    if (i % 6 === 5) {
      renderer.getContext().finish();
      await nextFrame();
    }
  }
  camera.projectionMatrix.copy(base.projection);
  camera.projectionMatrixInverse.copy(base.projection).invert();
  camera.position.copy(base.position);
  camera.quaternion.copy(base.quaternion);
  camera.updateMatrixWorld(true);
  pipeline.setCamera(camera);
  pipeline.finishAccumulation(7);
  renderer.getContext().finish();
  window.__stats = { samples: SAMPLES, ms: Math.round(performance.now() - t0), width, height, t };
  window.__ready = true;
  return window.__stats;
}

async function main() {
  const data = await loadData();
  const renderer = createRenderer();
  document.documentElement.style.setProperty('--page', THEME.page);
  const ctx = buildScene(renderer, data);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const pipeline = new Pipeline(renderer, { width: size.x, height: size.y, msaa: STILL ? 0 : 4, backdrop: THEME.backdrop });
  pipeline.exposure = TUNE.exposure;
  pipeline.bloom.strength = TUNE.bloom;
  pipeline.grain = TUNE.grain;
  if (THEME.underglow) pipeline.setFloorGlow({ box: ctx.box, ...THEME.underglow.desk });
  const camera = new THREE.PerspectiveCamera();
  placeCamera(camera, VIEW, window.innerWidth / window.innerHeight);
  pipeline.setCamera(camera);

  const { timeline } = ctx.keyboard;
  window.__timeline = { loop: timeline.loop, keys: timeline.order.length, step: timeline.step, blinkPeriod: timeline.blinkPeriod };
  const explicitT = params.has('t');
  let stillT = explicitT ? Number(params.get('t')) : restTime(timeline);

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    pipeline.setSize(s.x, s.y);
    placeCamera(camera, VIEW, window.innerWidth / window.innerHeight);
    if (STILL) renderStill(ctx, renderer, pipeline, camera, stillT, explicitT);
  });

  if (STILL) {
    window.__renderAt = (t) => {
      stillT = t;
      return renderStill(ctx, renderer, pipeline, camera, t, true);
    };
    window.__poseKeyAt = (t) => poseKey(timeline, ctx.keyboard.keys.length, t);
    await renderStill(ctx, renderer, pipeline, camera, stillT, explicitT);
  } else {
    liveLoop(ctx, renderer, pipeline, camera, performance.now());
  }
  window.__scene = { ctx, renderer, pipeline, camera, THREE };
}

main().catch((err) => {
  console.error(err);
  window.__error = String(err?.stack ?? err);
});
