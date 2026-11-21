// Standard ANSI 75% layout: 83 keys plus a rotary knob, 16u wide, no gaps between rows.
// Units: 1u = one key pitch (19.05 mm). x runs 0..16, z runs 0..6 (row 0 at the back).
// Reading order is top-left -> bottom-right; every key is one day.

export const LAYOUT_WIDTH = 16;

const k = (id, w = 1) => ({ id, w });
const fKeys = Array.from({ length: 12 }, (_, i) => k(`f${i + 1}`));
const letters = (s) => [...s].map((c) => k(c));

export const ROWS = [
  [k('esc'), ...fKeys, k('prtsc'), k('del'), { id: 'knob', w: 1, knob: true }],
  [...'`1234567890-='.split('').map((c) => k(c)), k('bksp', 2), k('home')],
  [k('tab', 1.5), ...letters('qwertyuiop[]'), k('\\', 1.5), k('pgup')],
  [k('caps', 1.75), ...letters("asdfghjkl;'"), k('enter', 2.25), k('pgdn')],
  [k('lshift', 2.25), ...letters('zxcvbnm,./'), k('rshift', 1.75), k('up'), k('end')],
  [k('lctrl', 1.25), k('win', 1.25), k('lalt', 1.25), k('space', 6.25), k('ralt'), k('fn'), k('rctrl'), k('left'), k('down'), k('right')],
];

/** @returns {{keys: object[], knob: {x:number,z:number}, width: number, depth: number}} key centres in units */
export function buildLayout() {
  const keys = [];
  let knob = null;
  ROWS.forEach((row, r) => {
    let x = 0;
    row.forEach((item) => {
      const placed = { id: item.id, w: item.w, row: r, x: x + item.w / 2, z: r + 0.5 };
      if (item.knob) knob = { x: placed.x, z: placed.z };
      else keys.push(placed);
      x += item.w;
    });
  });
  return { keys, knob, width: LAYOUT_WIDTH, depth: ROWS.length };
}

/** Attach the most recent days to the keys: oldest -> Esc, today -> last key (the right arrow). */
export function assignDays(keys, days) {
  const recent = days.slice(-keys.length);
  const offset = keys.length - recent.length;
  return keys.map((key, idx) => ({ ...key, day: idx < offset ? null : recent[idx - offset] }));
}
