// Camera presets and the lens/pixel jitter used for progressive (accumulated) stills.
import * as THREE from 'three';

const rad = (d) => (d * Math.PI) / 180;

/** az: degrees from the front towards +x (negative = camera on the left). hfov is kept constant across aspect ratios. */
export const VIEWS = {
  hero: { az: -21, el: 24, dist: 38, hfov: 39, target: [0.55, 1.2, -0.35], aperture: 0.1 },
  keys: { az: -24, el: 26, dist: 8.4, vfov: 24, target: [5.0, 1.7, 3.5], aperture: 0.03 }, // tall keys, arrows and the legend
  oled: { az: -24, el: 30, dist: 8.2, vfov: 24, target: [6.2, 3.45, -3.5], aperture: 0.03 },
};

export function placeCamera(camera, view, aspect, drift = { az: 0, el: 0, dist: 0 }) {
  const az = rad(view.az + drift.az);
  const el = rad(view.el + drift.el);
  const d = view.dist + drift.dist;
  const t = new THREE.Vector3(...view.target);
  camera.position.set(t.x + d * Math.cos(el) * Math.sin(az), t.y + d * Math.sin(el), t.z + d * Math.cos(el) * Math.cos(az));
  camera.up.set(0, 1, 0);
  camera.lookAt(t);
  camera.aspect = aspect;
  camera.fov = view.vfov ?? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(rad(view.hfov) / 2) / aspect));
  camera.near = 1;
  camera.far = 160;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return t;
}

/** Radical inverse: low-discrepancy sequence for even coverage with few samples. */
export function halton(index, base) {
  let f = 1;
  let r = 0;
  let i = index + 1;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

/**
 * Sub-pixel jitter (anti-aliasing) plus lens-disc jitter (depth of field) applied through the projection matrix.
 * The focus plane stays fixed while the camera slides across the aperture.
 */
export function jitterCamera(camera, base, { px, py, lensX, lensY, aperture, focusDist, width, height }) {
  camera.projectionMatrix.copy(base.projection);
  camera.position.copy(base.position);
  camera.quaternion.copy(base.quaternion);
  camera.updateMatrixWorld(true);

  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const dx = lensX * aperture;
  const dy = lensY * aperture;
  camera.position.addScaledVector(right, dx).addScaledVector(up, dy);
  camera.updateMatrixWorld(true);

  const e = camera.projectionMatrix.elements;
  // shear so points on the focus plane do not move when the eye does
  e[8] += -e[0] * (dx / focusDist);
  e[9] += -e[5] * (dy / focusDist);
  // sub-pixel offset in NDC
  e[8] += (-2 * px) / width;
  e[9] += (-2 * py) / height;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}
