// Studio: environment map (RoomEnvironment + extra softboxes), shadow-catching ground, contact shadow, lights, underglow.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

/** Image-based lighting: the stock room plus a few emissive softboxes so metal and clearcoat get long, clean reflections. */
export function buildEnvironment(renderer, boxes) {
  const room = new RoomEnvironment();
  const rig = new THREE.Group();
  rig.position.y = 3.5; // RoomEnvironment is offset by -3.5, cancel it so boxes use world-like coordinates
  room.add(rig);

  for (const [w, h, pos, rgb, power] of boxes) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(...rgb).multiplyScalar(power), side: THREE.DoubleSide, toneMapped: false }),
    );
    mesh.position.set(...pos);
    mesh.lookAt(0, 0, 0);
    rig.add(mesh);
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(room, 0.012);
  pmrem.dispose();
  return target.texture;
}

/** A rounded rectangle blurred into a soft blob (contact shadow or glow pool), as a texture. */
function blobTexture({ width, depth, pad, radius, blur, color = 'rgba(0,0,0,1)', alpha, ppu = 48 }) {
  const w = Math.round((width + pad * 2) * ppu);
  const h = Math.round((depth + pad * 2) * ppu);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.filter = `blur(${blur * ppu}px)`;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(pad * ppu, pad * ppu, width * ppu, depth * ppu, radius * ppu);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, w: width + pad * 2, h: depth + pad * 2 };
}

/**
 * Ground that only draws shadows (the backdrop itself is composited in the final pass),
 * plus two baked contact-shadow layers hugging the case.
 */
export function buildGround(footprint, theme) {
  const group = new THREE.Group();
  const shadowMat = new THREE.ShadowMaterial({ color: new THREE.Color(theme.shadowColor), opacity: 0.4, transparent: true });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), shadowMat);
  plane.rotation.x = -Math.PI / 2;
  plane.receiveShadow = true;
  group.add(plane);

  const layers = [
    { pad: 2, radius: 0.7, blur: 0.12, alpha: 0.55 * theme.contactAlpha, y: 0.004, offset: [0, 0] },
    { pad: 4, radius: 1.2, blur: 0.55, alpha: 0.4 * theme.contactAlpha, y: 0.003, offset: [-0.15, -0.1] },
  ];
  for (const l of layers) {
    const { tex, w, h } = blobTexture({ width: footprint.width, depth: footprint.depth, ...l });
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: new THREE.Color(theme.contactColor) }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(footprint.cx + l.offset[0], l.y, footprint.cz + l.offset[1]);
    group.add(mesh);
  }
  return { group, shadowMat };
}

export function buildLights(scene, theme) {
  const sun = new THREE.DirectionalLight(theme.key.color, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const cam = sun.shadow.camera;
  cam.left = -13;
  cam.right = 13;
  cam.top = 13;
  cam.bottom = -13;
  cam.near = 2;
  cam.far = 70;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 1.5;
  scene.add(sun, sun.target);

  let rim = null;
  if (theme.rim) {
    rim = new THREE.DirectionalLight(theme.rim.color, theme.rim.intensity);
    rim.position.set(...theme.rim.direction).multiplyScalar(30);
    scene.add(rim, rim.target);
  }
  return { sun, rim };
}

/**
 * Low strip light in front of the case for the night theme's underglow: it washes the lower front wall.
 * An area light gives a soft band of reflection (point lights left hot-spots on the clearcoat).
 * The glow on the desk itself is drawn by the final pass (see Pipeline.setFloorGlow). `footprint` is the case's plan view.
 */
export function buildUnderglow(footprint, theme) {
  if (!theme.underglow) return null;
  const { color, light, stripHeight } = theme.underglow;
  RectAreaLightUniformsLib.init();
  const frontZ = footprint.cz + footprint.depth / 2;
  const strip = new THREE.RectAreaLight(color, light, footprint.width * 0.95, stripHeight);
  strip.position.set(footprint.cx, 0.3, frontZ + 0.55); // emits along its local -z, i.e. back towards the case
  return strip;
}
