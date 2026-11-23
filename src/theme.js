// Day and night look-dev in one table. `day` is the original cream studio; `night` is a dark GitHub-style page (#0d1117)
// where the OLED glow, an amber underglow and a cool rim light do the lighting.
import { BRAND } from './palette.js';

/** Softbox spec: [width, height, [x, y, z], [r, g, b], power]. They are baked into the reflection environment. */
const DAY_BOXES = [
  [22, 11, [-4, 13, 6], [1, 0.96, 0.9], 5.5], // big overhead, warm
  [3.2, 15, [-15, 5, 4], [1, 0.97, 0.92], 3.4], // tall strip, camera side
  [2.4, 13, [15, 4.5, -3], [0.82, 0.9, 1], 4.4], // cool rim strip, far side
  [24, 3.2, [0, 8, -15], [1, 0.97, 0.94], 3.6], // back bar
  [26, 2.4, [0, 1.2, 15], [1, 0.9, 0.78], 1.5], // low warm bounce in front
];

const NIGHT_BOXES = [
  [22, 11, [-4, 13, 6], [0.5, 0.62, 1], 2.2], // dim cool overhead
  [3.2, 15, [-15, 5, 4], [0.62, 0.74, 1], 3.2], // tall strip, camera side
  [2.4, 13, [15, 4.5, -3], [0.5, 0.78, 1], 9], // rim strip, far side
  [24, 3.2, [0, 8, -15], [0.7, 0.84, 1], 8], // back bar: long reflections along the back edge
  [26, 2.4, [0, 1.2, 15], [1, 0.62, 0.22], 3.2], // amber bounce from the desk in front
];

export const THEMES = {
  day: {
    id: 'day',
    page: BRAND.cream,
    backdrop: {
      center: BRAND.cream,
      edge: '#E4D7BD',
      focus: [0.5, 0.46],
      scale: [0.42, 0.95],
      falloff: [0.1, 1.2],
      vignette: 0.12,
      grain: 1.1 / 255,
    },
    exposure: 1,
    env: { boxes: DAY_BOXES, intensity: 0.5 },
    key: { color: 0xfff0dc, intensity: 1.9, shadow: 0.36 },
    dome: { color: 0xe6eeff, intensity: 0.9, shadow: 0.3 },
    shadowColor: '#33200e',
    contactColor: '#20140a',
    contactAlpha: 1,
    rim: null,
    underglow: null,
    oledGlow: 0.5, // area light on the screen, nits
    capEmissive: 0, // share of a cap's own colour it emits (lifts the shadows at night)
    pocketGlow: 0,
  },
  night: {
    id: 'night',
    page: '#0d1117',
    backdrop: {
      center: '#1b2431',
      edge: '#0d1117',
      focus: [0.5, 0.5],
      scale: [0.72, 1.7],
      falloff: [0.05, 1.0],
      vignette: 0,
      grain: 1.1 / 255,
    },
    exposure: 1.1,
    env: { boxes: NIGHT_BOXES, intensity: 0.55 },
    key: { color: 0xc9d7ff, intensity: 1.15, shadow: 0.3 },
    dome: { color: 0x8da4e6, intensity: 0.5, shadow: 0.2 },
    shadowColor: '#000000',
    contactColor: '#000000',
    contactAlpha: 0.7,
    rim: { color: 0xa9c4ff, intensity: 1.6, direction: [0.6, 0.45, -0.7] },
    underglow: {
      color: BRAND.deepAmber, // low strip light that washes the case's front wall
      light: 2.5,
      stripHeight: 0.6,
      // glow on the desk around the case, added in the final pass; the colour is the midpoint of Deep Amber and Beak Orange
      desk: { color: '#F1992C', strength: 0.3, falloff: 1.1, radius: 0.7, reach: 2.6, fade: 0.16 },
    },
    oledGlow: 12,
    capEmissive: 0.07,
    pocketGlow: 0.06,
  },
};

export function themeById(id) {
  return THEMES[id] ?? THEMES.day;
}
