// What the OLED shows and where each element sits on its 128 x 64 dot grid. Pure (no DOM), so tests can run it in node.
import { ADVANCE, GLYPH_H, GLYPH_W } from './pixelFont.js';

const CAP_ROWS = 7; // glyph rows above the baseline; row 7 is only used by descenders

export const OLED_W = 128;
export const OLED_H = 64;

export const LAYOUT = {
  margin: 3, // blank columns kept at the left and right edge
  labelX: 3, // label column
  valueX: 45, // value column; the longest label (STREAK) ends at x = 37
  headerY: 2,
  ruleTopY: 11,
  rowY: [14, 23, 32, 41],
  ruleBottomY: 50,
  footY: 55, // glyph rows 55..61, descenders 62
  spark: { barW: 2, gap: 1, maxH: 10, baseY: 61, labelGap: 4, bars: 7 },
  dot: { x: 120, y: 2 },
};

const DOT = ['.###.', '#####', '#####', '#####', '.###.'];
const DIM = 0.5;
const UNIT = 0.7;
const BRIGHT = 1;

const unitOf = (n, singular) => (n === 1 ? singular : `${singular}s`);
const hhmm = (iso) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** Everything that appears on the display, derived from the aggregates in data.json. */
export function oledModel(data) {
  const counts = data.days.map((d) => d.count);
  const last7 = counts.slice(-LAYOUT.spark.bars);
  const week = last7.reduce((sum, c) => sum + c, 0);
  return {
    login: `@${data.login}`,
    rows: [
      { label: 'TODAY', num: String(data.todayCount), unit: unitOf(data.todayCount, 'contrib') },
      { label: 'WEEK', num: String(week), unit: unitOf(week, 'contrib') },
      { label: 'STREAK', num: String(data.currentStreak), unit: unitOf(data.currentStreak, 'day') },
      { label: String(data.asOf).slice(0, 4), num: String(data.yearTotal), unit: 'this yr' },
    ],
    last7,
    updated: hhmm(data.generatedAt),
  };
}

export const textWidth = (str) => (str.length === 0 ? 0 : str.length * ADVANCE - (ADVANCE - GLYPH_W));
const box = (str, x, y) => ({ x0: x, x1: x + textWidth(str) - 1, y0: y, y1: y + GLYPH_H - 1 });

/** Height in dots of a sparkline bar: zero days are a 1-dot tick, any real day is at least 2 dots. */
export function barHeight(value, max, maxH = LAYOUT.spark.maxH) {
  if (value <= 0) return 1;
  return Math.max(2, Math.round(maxH * Math.sqrt(value / Math.max(max, 1))));
}

/**
 * Compose the screen.
 * @param {import('./pixelFont.js').PixelGrid} grid
 * @param {ReturnType<typeof oledModel>} model
 * @param {{live?: number}} o live: 1 while the status dot is lit, 0 while it is dark
 * @returns bounding boxes of every element, for layout checks
 */
export function drawOled(grid, model, { live = 1 } = {}) {
  const L = LAYOUT;
  const boxes = { rows: [] };
  grid.clear();

  grid.text(model.login, L.labelX, L.headerY, BRIGHT);
  boxes.header = box(model.login, L.labelX, L.headerY);

  DOT.forEach((row, j) => {
    [...row].forEach((c, i) => {
      if (c === '#') grid.set(L.dot.x + i, L.dot.y + j, live ? BRIGHT : 0.18);
    });
  });
  boxes.dot = { x0: L.dot.x, x1: L.dot.x + 4, y0: L.dot.y, y1: L.dot.y + 4 };

  grid.rule(L.margin, L.ruleTopY, OLED_W - 2 * L.margin, 0.3, 2);

  model.rows.forEach((row, i) => {
    const y = L.rowY[i];
    grid.text(row.label, L.labelX, y, DIM);
    grid.text(row.num, L.valueX, y, BRIGHT);
    const unitX = L.valueX + (row.num.length + 1) * ADVANCE;
    grid.text(row.unit, unitX, y, UNIT);
    boxes.rows.push({
      label: box(row.label, L.labelX, y),
      value: { x0: L.valueX, x1: box(row.unit, unitX, y).x1, y0: y, y1: y + GLYPH_H - 1 },
    });
  });

  grid.rule(L.margin, L.ruleBottomY, OLED_W - 2 * L.margin, 0.3, 2);

  const clock = live ? model.updated : model.updated.replace(':', ' ');
  const foot = `updated ${clock}`;
  grid.text(foot, L.labelX, L.footY, DIM);
  boxes.foot = box(foot, L.labelX, L.footY);

  const s = L.spark;
  const sparkW = s.bars * s.barW + (s.bars - 1) * s.gap;
  const sparkX = OLED_W - L.margin - sparkW;
  const maxV = Math.max(...model.last7, 1);
  model.last7.forEach((v, i) => {
    const h = barHeight(v, maxV, s.maxH);
    const level = v === 0 ? DIM : i === model.last7.length - 1 ? BRIGHT : UNIT;
    grid.rect(sparkX + i * (s.barW + s.gap), s.baseY - h + 1, s.barW, h, level);
  });
  const labelX = sparkX - s.labelGap - textWidth('7d');
  const sparkLabelY = s.baseY - (CAP_ROWS - 1); // cap rows end on the baseline
  grid.text('7d', labelX, sparkLabelY, DIM);
  boxes.spark = { x0: sparkX, x1: OLED_W - L.margin - 1, y0: s.baseY - s.maxH + 1, y1: s.baseY };
  boxes.sparkLabel = box('7d', labelX, sparkLabelY);
  return boxes;
}
