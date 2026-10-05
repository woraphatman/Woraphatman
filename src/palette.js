// Brand law: these five hex values are exact. Everything else is derived from them.
import * as THREE from 'three';

export const BRAND = {
  duckYellow: '#FFD43B',
  beakOrange: '#FF8A3C',
  pondNavy: '#242A38',
  deepAmber: '#E3A81C',
  cream: '#FAF4E6',
};

/** Cap colour for days with no contributions: a muted cream-grey, so empty days read as "blank keys". */
export const ZERO_CAP = '#B4AFA3';

const STOPS = [
  [0.0, new THREE.Color(BRAND.cream)],
  [0.34, new THREE.Color(BRAND.duckYellow)],
  [0.67, new THREE.Color(BRAND.deepAmber)],
  [1.0, new THREE.Color(BRAND.beakOrange)],
];

/** 0 for an empty day, otherwise 0.08..1 on a square-root curve so a 39-commit day does not flatten everything else. */
export function contributionLevel(count, max) {
  if (count <= 0) return 0;
  if (max <= 1) return 1;
  return 0.08 + 0.92 * Math.sqrt((count - 1) / (max - 1));
}

/** Cream -> Duck Yellow -> Deep Amber -> Beak Orange, interpolated in linear light. */
export function rampColor(level, out = new THREE.Color()) {
  const t = Math.min(1, Math.max(0, level));
  for (let i = 1; i < STOPS.length; i += 1) {
    if (t <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1];
      const [t1, c1] = STOPS[i];
      return out.lerpColors(c0, c1, (t - t0) / (t1 - t0));
    }
  }
  return out.copy(STOPS[STOPS.length - 1][1]);
}

export function capColor(count, max, out = new THREE.Color()) {
  return count <= 0 ? out.set(ZERO_CAP) : rampColor(contributionLevel(count, max), out);
}

/** Ramp positions of the legend swatches after the empty-day swatch: the lightest real day, then the three brand stops. */
export const LEGEND_LEVELS = [0.08, 0.34, 0.67, 1];

/** The five swatches of the on-case legend, "less" -> "more", using the same colours as the keys. */
export function legendColors() {
  return [new THREE.Color(ZERO_CAP), ...LEGEND_LEVELS.map((level) => rampColor(level))];
}
