// Drag-to-spin on the live page: direction, tilt limits, coasting after release, reset, and the one-time hint callback.
import assert from 'node:assert/strict';
import { attachOrbit } from '../src/orbit.js';

const listeners = {};
const canvas = {
  style: {},
  addEventListener: (type, fn) => (listeners[type] ??= []).push(fn),
  setPointerCapture: () => {},
};
const fire = (type, e = {}) => (listeners[type] ?? []).forEach((fn) => fn({ pointerId: 1, clientX: 0, clientY: 0, timeStamp: 0, ...e }));

let grabs = 0;
const orbit = attachOrbit(canvas, () => { grabs += 1; });
assert.equal(canvas.style.touchAction, 'none', 'a drag must not scroll the page');
assert.deepEqual({ az: orbit.state.az, el: orbit.state.el }, { az: 0, el: 0 });

// moves without a pressed pointer do nothing
fire('pointermove', { clientX: 50, clientY: 50, timeStamp: 10 });
assert.equal(orbit.state.az, 0);

// dragging right by 100 px turns the camera to the left (az falls); dragging down tilts it up
fire('pointerdown', { clientX: 100, clientY: 100, timeStamp: 0 });
fire('pointermove', { clientX: 200, clientY: 120, timeStamp: 100 });
assert.ok(Math.abs(orbit.state.az - -35) < 1e-9, `az ${orbit.state.az}`);
assert.ok(Math.abs(orbit.state.el - 7) < 1e-9, `el ${orbit.state.el}`);
assert.equal(grabs, 1);

// the tilt stops at its limits however far the pointer goes
fire('pointermove', { clientX: 200, clientY: 5000, timeStamp: 200 });
assert.equal(orbit.state.el, 46);
fire('pointermove', { clientX: 200, clientY: -5000, timeStamp: 300 });
assert.equal(orbit.state.el, -18);

// while the pointer is down the spin does not run on its own
const held = orbit.state.az;
orbit.update(1);
assert.equal(orbit.state.az, held);

// a fast flick keeps turning after release in the same direction, and slows down
fire('pointermove', { clientX: 300, clientY: -5000, timeStamp: 400 });
fire('pointerup');
const released = orbit.state.az;
orbit.update(0.1);
const first = orbit.state.az - released;
assert.ok(first < 0, 'the flick keeps turning to the left');
orbit.update(0.1);
const second = orbit.state.az - released - first;
assert.ok(Math.abs(second) < Math.abs(first), 'the spin slows down');
for (let i = 0; i < 400; i += 1) orbit.update(0.05);
const rest = orbit.state.az;
orbit.update(1);
assert.equal(orbit.state.az, rest, 'the spin eventually stops');

// a second drag does not call the hint callback again; a double click puts the view back
fire('pointerdown', { clientX: 0, clientY: 0, timeStamp: 1000 });
fire('pointerup');
assert.equal(grabs, 1);
fire('dblclick');
assert.deepEqual({ az: orbit.state.az, el: orbit.state.el, spin: orbit.state.spin }, { az: 0, el: 0, spin: 0 });

process.stdout.write('orbit ok: direction, limits, coasting, reset\n');
