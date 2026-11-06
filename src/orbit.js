// Drag-to-spin for the live page: dragging (or swiping) turns the camera around the keyboard, the spin coasts on after
// release, and a double click puts the view back. Plain state plus pointer listeners, no three.js.
const DEG_PER_PX = 0.35;
const FRICTION = 2.5; // per second: how fast a released spin slows down
const MAX_SPIN = 720; // degrees per second
const EL_RANGE = [-18, 46]; // degrees of tilt relative to the camera preset

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * @param {HTMLElement} canvas element that receives the pointer events
 * @param {() => void} [onFirstDrag] called once, when the visitor first grabs the keyboard
 * @returns {{state: {az: number, el: number}, update: (dt: number) => void, reset: () => void}}
 */
export function attachOrbit(canvas, onFirstDrag = () => {}) {
  const state = { az: 0, el: 0, spin: 0 };
  let drag = null;
  let grabbed = false;
  canvas.style.touchAction = 'none'; // a drag must not scroll or zoom the page

  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, at: e.timeStamp };
    state.spin = 0;
    canvas.setPointerCapture(e.pointerId);
    if (!grabbed) onFirstDrag();
    grabbed = true;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dt = Math.max(1, e.timeStamp - drag.at) / 1000;
    const dAz = -(e.clientX - drag.x) * DEG_PER_PX; // dragging right brings the front of the keyboard to the right
    state.az += dAz;
    state.el = clamp(state.el + (e.clientY - drag.y) * DEG_PER_PX, EL_RANGE[0], EL_RANGE[1]);
    state.spin = clamp(dAz / dt, -MAX_SPIN, MAX_SPIN);
    drag = { x: e.clientX, y: e.clientY, at: e.timeStamp };
  });
  const release = () => {
    drag = null;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  const reset = () => {
    state.az = 0;
    state.el = 0;
    state.spin = 0;
  };
  canvas.addEventListener('dblclick', reset);

  /** Advance the coasting spin by dt seconds. */
  const update = (dt) => {
    if (drag) return;
    state.az += state.spin * dt;
    state.spin = Math.abs(state.spin) < 1 ? 0 : state.spin * Math.exp(-FRICTION * dt);
  };
  return { state, update, reset };
}
