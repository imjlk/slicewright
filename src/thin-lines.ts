import type { Finding } from './inspect.js';
import { pixelDifference, pixelOffset, type Raster } from './raster.js';
import type { ResizeFilter } from './resize.js';

/** Fractions of the content at which the sample lines run, as content padding uses. */
const sampleFractions = [0.4, 0.45, 0.5, 0.55, 0.6] as const;
/** How far in from each edge a line is looked for, as a fraction of the length. */
const searchDepth = 0.25;
/** Neighbor difference (premultiplied, alpha included) that still continues a segment. */
const runTolerance = 40;
/** Difference from both sides that makes a run a drawn line. */
const lineContrast = 48;
/** A line is drawn in opaque pixels; lower alpha is the anti-aliased edge. */
const opaqueAlpha = 224;
/** Sample lines on a side that must agree before it is reported. */
const agreeingLines = 3;

type Side = 'left' | 'right' | 'top' | 'bottom';

/**
 * Predicts drawn lines a downscale will lose. Area averaging leaves a line
 * `width / factor` of its contrast, so a line narrower than half the factor
 * fades; nearest sampling can drop a line narrower than the factor outright.
 * Along up to five sample lines per side it walks in from the edge and finds a
 * line narrower than that limit with only narrow segments between it and the
 * fill (see `firstLineWidth`). A side is reported when at least three sample
 * lines find one.
 *
 * @evidence docs/spec.md#normalization Finds outlines narrower than the downscale factor allows along five sample lines per side and warns when three agree.
 * @evidenceReview docs/spec.md#normalization #e2c2c11 Checked this code against the section line by line and ran normalizesGeneratedArt green with pnpm test.
 */
export function thinLineFindings(
  source: Raster,
  factor: { readonly x: number; readonly y: number },
  filter: ResizeFilter,
): Finding[] {
  // Width a line needs to keep half its contrast (area) or to survive at all (nearest).
  const limit = (axisFactor: number): number =>
    filter === 'nearest' ? axisFactor : axisFactor / 2;
  const sides: Array<{ side: Side; widths: number[]; factor: number }> = [];
  // Distinct sample lines only: on a tiny image several fractions land on one.
  const samples = (length: number): number[] => [
    ...new Set(sampleFractions.map((fraction) => Math.floor(length * fraction))),
  ];
  const rows = samples(source.height);
  const columns = samples(source.width);
  const horizontal = (y: number) => (x: number) => pixelOffset(source, x, y);
  const vertical = (x: number) => (y: number) => pixelOffset(source, x, y);
  const scan = (
    side: Side,
    lines: readonly number[],
    at: (line: number) => (position: number) => number,
    length: number,
    inward: 1 | -1,
    axisFactor: number,
  ): void => {
    // Area averaging cannot lose a whole pixel below 2x; nearest can drop one above 1x.
    if (axisFactor <= 1 || lines.length < agreeingLines) {
      return;
    }
    const widths = lines
      .map((line) => firstLineWidth(source, at(line), length, inward, limit(axisFactor)))
      .filter((width): width is number => width !== undefined);
    if (widths.length >= agreeingLines) {
      sides.push({ side, widths, factor: axisFactor });
    }
  };
  scan('left', rows, horizontal, source.width, 1, factor.x);
  scan('right', rows, horizontal, source.width, -1, factor.x);
  scan('top', columns, vertical, source.height, 1, factor.y);
  scan('bottom', columns, vertical, source.height, -1, factor.y);
  if (sides.length === 0) {
    return [];
  }
  const thickness = Math.max(...sides.map((side) => Math.ceil(limit(side.factor))));
  const described = sides
    .map((side) => `${side.side} (up to ${Math.max(...side.widths)} px, shrunk ${side.factor.toFixed(1)} times)`)
    .join(', ');
  return [
    {
      code: 'resize.thin-lines',
      severity: 'warning',
      message: `Lines drawn straight onto the fill along the ${described} ${filter === 'nearest' ? 'can drop out' : 'fade into their neighbors'}. Ask for outlines at least ${thickness} px thick in the source, or normalize to a larger size.`,
      details: Object.fromEntries(sides.map((side) => [side.side, side.widths])),
    },
  ];
}

/**
 * Walks one sample line from an edge inward, past the transparent margin and
 * the anti-aliased ramp, and splits it into segments of one color (any alpha).
 * A segment that reaches the search depth is the fill, opaque, translucent, or
 * empty. A segment at least `limit` wide is a rim, which keeps marking the
 * border, so the walk stops. Narrower segments are skipped, so a double stroke
 * still reaches the fill; the first of them that differs from both neighbors
 * is the line. Returns the line's width when the walk reaches the fill.
 */
function firstLineWidth(
  raster: Raster,
  at: (position: number) => number,
  length: number,
  inward: 1 | -1,
  limit: number,
): number | undefined {
  const start = inward === 1 ? 0 : length - 1;
  const depth = Math.floor(length * searchDepth);
  const searching = (index: number): boolean =>
    index >= 0 && index < length && Math.abs(index - start) < depth;
  let position = start;
  // Skip the transparent margin and the anti-aliased ramp: the border begins opaque.
  while (searching(position) && alphaOf(raster, at(position)) < opaqueAlpha) {
    position += inward;
  }
  // Outside the first opaque pixel counts as transparency.
  let before: number | undefined;
  let line: number | undefined;
  while (searching(position)) {
    const segmentStart = position;
    while (
      searching(position + inward) &&
      pixelDifference(raster, at(position), at(position + inward)) <= runTolerance
    ) {
      position += inward;
    }
    if (!searching(position + inward)) {
      // This segment runs to the end of the search: the fill.
      return line;
    }
    const width = Math.abs(position - segmentStart) + 1;
    if (width >= limit) {
      return undefined;
    }
    const middle = at(segmentStart + inward * Math.trunc((width - 1) / 2));
    const after = at(position + inward);
    const contrastsBefore =
      before === undefined
        ? alphaOf(raster, middle) > lineContrast
        : pixelDifference(raster, middle, before) > lineContrast;
    if (
      line === undefined &&
      contrastsBefore &&
      pixelDifference(raster, middle, after) > lineContrast
    ) {
      line = width;
    }
    before = at(position);
    position += inward;
  }
  return undefined;
}

function alphaOf(raster: Raster, offset: number): number {
  return raster.data[offset + 3] ?? 0;
}
