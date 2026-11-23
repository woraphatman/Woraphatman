// OLED status display: a sloped aluminium pod seated in the key pocket, black glass, a dot-matrix texture.
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { Loft } from './loft.js';
import { PixelGrid } from './pixelFont.js';
import { drawOled, OLED_W, OLED_H } from './oledLayout.js';
import { BRAND } from './palette.js';

export const POD = {
  x0: 12.38,
  x1: 15.96,
  z0: -2.26,
  z1: -0.54,
  frontTop: 0.42, // height of the pod's front edge above the case rim
  slopeDeg: 28, // extra tilt towards the viewer, on top of the case tilt
  radius: 0.2,
  fillet: 0.12,
  floorY: -0.1,
  screenW: 3.3,
};

const CELL = 8;
const GLOW_SCALE = 1.5; // glow plane is this much larger than the screen

export function podTopY(z, cfg = POD) {
  return cfg.frontTop + (cfg.z1 - z) * Math.tan((cfg.slopeDeg * Math.PI) / 180);
}

function buildPodGeometry(cfg = POD) {
  const loft = new Loft(12);
  const hx = (cfg.x1 - cfg.x0) / 2;
  const hz = (cfg.z1 - cfg.z0) / 2;
  const cx = (cfg.x0 + cfg.x1) / 2;
  const cz = (cfg.z0 + cfg.z1) / 2;
  const ring = (grow, r, yAt) => loft.ring({ cx, cz, hx: hx - grow, hz: hz - grow, r }, yAt);

  const bottom = ring(0, cfg.radius, () => cfg.floorY);
  const wall = ring(0, cfg.radius, (x, z) => podTopY(z, cfg) - cfg.fillet);
  loft.band(bottom, wall);
  let prev = wall;
  const steps = 8;
  for (let i = 1; i <= steps; i += 1) {
    const phi = (i / steps) * (Math.PI / 2);
    const inset = cfg.fillet * (1 - Math.cos(phi));
    const lift = cfg.fillet * Math.sin(phi) - cfg.fillet;
    const r = ring(inset, cfg.radius - inset, (x, z) => podTopY(z, cfg) + lift);
    loft.band(prev, r);
    prev = r;
  }
  loft.cap(prev, [cx, podTopY(cz, cfg), cz], true);
  loft.cap(bottom, [cx, cfg.floorY, cz], false);
  return loft.build();
}

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** UV-mapped rounded plane so a texture can fill it. */
function roundedPlane(w, h, r) {
  const geo = new THREE.ShapeGeometry(roundedRectShape(w, h, r), 10);
  const p = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i += 1) uv.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / h + 0.5);
  return geo;
}

/** Soft diagonal reflection across the glass: brightest at the top-left corner, gone by the middle. */
function sheenTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 256, 128);
  g.addColorStop(0, 'rgba(255,255,255,0.1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.035)');
  g.addColorStop(0.65, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createOledScreen(model) {
  const canvas = document.createElement('canvas');
  canvas.width = OLED_W * CELL;
  canvas.height = OLED_H * CELL;
  const ctx = canvas.getContext('2d');
  const grid = new PixelGrid(OLED_W, OLED_H);
  const tintRgb = [255, 212, 59]; // Duck Yellow #FFD43B

  // blurred copy of the picture, drawn additively over the glass and bezel: a controlled, selective bloom
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = 768;
  glowCanvas.height = 384;
  const glowCtx = glowCanvas.getContext('2d');
  const paintGlow = () => {
    const { width: gw, height: gh } = glowCanvas;
    const inner = [gw / GLOW_SCALE, gh / GLOW_SCALE];
    glowCtx.clearRect(0, 0, gw, gh);
    glowCtx.globalCompositeOperation = 'lighter';
    for (const [blur, gain] of [[5, 0.9], [16, 1.0], [38, 1.3]]) {
      glowCtx.filter = `blur(${blur}px) brightness(${gain})`;
      glowCtx.drawImage(canvas, (gw - inner[0]) / 2, (gh - inner[1]) / 2, inner[0], inner[1]);
    }
    glowCtx.filter = 'none';
    glowCtx.globalCompositeOperation = 'source-over';
    glowTexture.needsUpdate = true;
  };

  /** @param {number} live 1 while the status dot is lit, 0 while it is dark */
  const draw = (live = 1) => {
    drawOled(grid, model, { live });
    grid.paint(ctx, CELL, 1.4, tintRgb);
    texture.needsUpdate = true;
    paintGlow();
  };

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;
  const glowTexture = new THREE.CanvasTexture(glowCanvas);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  draw();
  return { canvas, texture, glowTexture, draw };
}

/** Build the whole display assembly. Returns {group, screen, glow}. */
export function buildOled(model, { podMaterial, bezelMaterial, glowNits }) {
  RectAreaLightUniformsLib.init();
  const group = new THREE.Group();
  const pod = new THREE.Mesh(buildPodGeometry(), podMaterial);
  pod.castShadow = true;
  pod.receiveShadow = true;
  group.add(pod);

  const cx = (POD.x0 + POD.x1) / 2;
  const cz = (POD.z0 + POD.z1) / 2;
  const slope = (POD.slopeDeg * Math.PI) / 180;
  const surface = new THREE.Group();
  surface.position.set(cx, podTopY(cz) + 0.002, cz);
  surface.rotation.x = -Math.PI / 2 + slope;
  group.add(surface);

  const screenW = POD.screenW;
  const screenH = screenW / 2;
  const bezel = new THREE.Mesh(roundedPlane(screenW + 0.2, screenH + 0.2, 0.09), bezelMaterial);
  bezel.receiveShadow = true;
  surface.add(bezel);

  const screen = createOledScreen(model);
  const display = new THREE.Mesh(
    roundedPlane(screenW, screenH, 0.035),
    new THREE.MeshBasicMaterial({ map: screen.texture, color: new THREE.Color().setScalar(2.4), toneMapped: false }),
  );
  display.position.z = 0.004;
  surface.add(display);

  // A baked, additive sheen instead of a lit glass pane. A physically lit, near-mirror pane flashed white fireflies whenever
  // a jittered sun sample came close to its mirror direction, and a rougher pane turned the black screen grey.
  const sheen = new THREE.Mesh(
    roundedPlane(screenW + 0.1, screenH + 0.1, 0.06),
    new THREE.MeshBasicMaterial({ map: sheenTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  sheen.position.z = 0.008;
  surface.add(sheen);

  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(screenW * GLOW_SCALE, (screenW / 2) * GLOW_SCALE),
    new THREE.MeshBasicMaterial({
      map: screen.glowTexture,
      color: new THREE.Color().setScalar(0.85),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  halo.position.z = 0.012;
  surface.add(halo);

  // The screen lights its surroundings. An area light lying in the screen plane cannot glint on its own glass
  // (a point light just above it left a white hot-spot in the middle of the text).
  const glow = new THREE.RectAreaLight(BRAND.duckYellow, glowNits, screenW, screenH);
  glow.rotation.y = Math.PI; // emit towards +z of the screen, i.e. out of the glass
  glow.position.z = 0.002;
  surface.add(glow);

  return { group, screen, glow, display, surface };
}
