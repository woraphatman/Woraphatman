// Deterministic key animation, modelled on the contribution "snake": keys that have contributions press down
// lightest -> darkest and stay down like eaten cells, then the whole board springs back up, today's key flashes
// once, the loop rests and restarts. Everything is a pure function of t, so any frame can be rendered on its own
// and the loop is seamless (every key is at its data height, and the glow at rest, at t = 0 and t = loop).
import { contributionLevel } from './palette.js';

export const KEY_PITCH_MM = 19.05;
export const SWITCH_TRAVEL_MM = 4;
/** Press depth in key units: about 70 % of a real MX switch's travel. */
export const PRESS_DEPTH = (0.7 * SWITCH_TRAVEL_MM) / KEY_PITCH_MM;

export const TIMING = {
  lead: 0.35, // seconds before the first key moves
  press: 0.3, // one key's trip down (eased in and out)
  eatWindow: 3.6, // target time to press every key; the step between keys is clamped to [minStep, maxStep]
  minStep: 0.045,
  maxStep: 0.09,
  hold: 0.25, // everything down before the board lets go
  stagger: 0.2, // left -> right spread of the spring-back
  spring: 0.7, // one key's spring-back
  flashOverlap: 0.1, // the flash starts this long before the last spring-back settles
  flash: 0.8,
  rest: 0.4,
  blinkTarget: 0.8, // live-dot blink period, stretched so a whole number of blinks fit in the loop
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v) => clamp(v, 0, 1);
const smooth = (t) => t * t * (3 - 2 * t);

/** Eased 0 -> 1 for a key travelling down. */
export const pressEase = (s) => smooth(clamp01(s));

const SPRING_ZETA = 0.5;
const SPRING_OMEGA = 9;
/** Damped-spring step response, 0 -> 1 over s in [0, 1] with a small overshoot, forced to settle exactly at s = 1. */
export function springStep(s) {
  if (s <= 0) return 0;
  if (s >= 1) return 1;
  const wd = SPRING_OMEGA * Math.sqrt(1 - SPRING_ZETA * SPRING_ZETA);
  const k = SPRING_ZETA / Math.sqrt(1 - SPRING_ZETA * SPRING_ZETA);
  const residual = Math.exp(-SPRING_ZETA * SPRING_OMEGA * s) * (Math.cos(wd * s) + k * Math.sin(wd * s));
  return 1 - residual * (1 - smooth(clamp01((s - 0.75) / 0.25)));
}

/**
 * @param {{x:number,z:number,count:number}[]} keys key centres and their day counts, in any order
 * @param {number} maxCount largest count on the board (colour level normaliser)
 */
export function buildTimeline(keys, maxCount) {
  const level = (k) => contributionLevel(k.count, maxCount);
  const order = keys
    .map((k, i) => i)
    .filter((i) => keys[i].count > 0)
    .sort((a, b) => level(keys[a]) - level(keys[b]) || keys[a].x - keys[b].x || keys[a].z - keys[b].z);

  const n = order.length;
  const step = n > 1 ? clamp(TIMING.eatWindow / n, TIMING.minStep, TIMING.maxStep) : 0;
  const pressAt = new Float64Array(keys.length).fill(Number.NaN);
  order.forEach((keyIndex, rank) => {
    pressAt[keyIndex] = TIMING.lead + rank * step;
  });

  const lastBottom = TIMING.lead + Math.max(0, n - 1) * step + TIMING.press;
  const releaseBase = lastBottom + TIMING.hold;
  const xs = keys.map((k) => k.x);
  const xMin = Math.min(...xs);
  const xSpan = Math.max(...xs) - xMin || 1;
  const releaseAt = new Float64Array(keys.length).fill(Number.NaN);
  order.forEach((keyIndex) => {
    releaseAt[keyIndex] = releaseBase + (TIMING.stagger * (keys[keyIndex].x - xMin)) / xSpan;
  });

  const flashStart = releaseBase + TIMING.stagger + TIMING.spring - TIMING.flashOverlap;
  const loop = flashStart + TIMING.flash + TIMING.rest;
  const blinkPeriod = loop / Math.max(1, Math.round(loop / TIMING.blinkTarget));
  return { loop, order, step, pressAt, releaseAt, releaseBase, flashStart, blinkPeriod };
}

const wrap = (t, loop) => ((t % loop) + loop) % loop;

/** How far key `i` is pushed down at time t, in key units (slightly negative while it overshoots on the way back). */
export function keyDepth(tl, i, t) {
  const pressStart = tl.pressAt[i];
  if (Number.isNaN(pressStart)) return 0;
  const tt = wrap(t, tl.loop);
  if (tt < tl.releaseAt[i]) return PRESS_DEPTH * pressEase((tt - pressStart) / TIMING.press);
  return PRESS_DEPTH * (1 - springStep((tt - tl.releaseAt[i]) / TIMING.spring));
}

/** 0 -> 1 -> 0 pulse for today's key glow, once per loop. */
export function todayFlash(tl, t) {
  const x = wrap(t, tl.loop) - tl.flashStart;
  if (x <= 0 || x >= TIMING.flash) return 0;
  const rise = 0.15;
  return x < rise ? smooth(x / rise) : 1 - smooth((x - rise) / (TIMING.flash - rise));
}

/** 1 while the live dot is lit, 0 while it is dark. */
export const liveDot = (tl, t) => (Math.floor(wrap(t, tl.loop) / (tl.blinkPeriod / 2)) % 2 === 0 ? 1 : 0);

/** A calm moment (all keys home, glow at rest) for still images. */
export const restTime = (tl) => tl.loop - TIMING.rest / 2;
