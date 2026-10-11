import { alphaAt, pixelDifference, pixelOffset, type Raster, type Rect } from './raster.js';

export type Axis = 'x' | 'y';

export interface MatchOptions {
  /** Largest premultiplied channel difference, 0 to 255, that still matches. */
  readonly tolerance: number;
  /** Fraction of cross-axis pixels allowed to exceed the tolerance. */
  readonly outlierRatio: number;
}

/** Stretch span on one axis: `start` inclusive, `end` exclusive. */
export interface AxisSpan {
  readonly start: number;
  readonly end: number;
}

export const defaultMatchOptions: MatchOptions = { tolerance: 4, outlierRatio: 0 };

/**
 * Bounds of the pixels that are not fully transparent, or undefined when
 * every pixel is.
 *
 * @evidence docs/spec.md#transparent-margins Finds the fully transparent border rows and columns.
 * @evidenceReview docs/spec.md#transparent-margins Read the section against this function and ran warnsAboutTransparentMargins green with pnpm test.
 */
export function contentBounds(raster: Raster): Rect | undefined {
  let minX = raster.width;
  let minY = raster.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      if (alphaAt(raster, x, y) > 0) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < 0) {
    return undefined;
  }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Whether line `index` matches line `index + 1` along the axis inside `bounds`.
 * Columns are lines on the x axis, rows on the y axis.
 *
 * @evidence docs/spec.md#stretch-detection Compares adjacent lines with the tolerance and outlier ratio.
 * @evidenceReview docs/spec.md#stretch-detection Read the section against this function and ran detectsPanelInsets green with pnpm test.
 */
export function linesMatch(
  raster: Raster,
  axis: Axis,
  index: number,
  other: number,
  bounds: Rect,
  options: MatchOptions,
): boolean {
  const crossStart = axis === 'x' ? bounds.y : bounds.x;
  const crossLength = axis === 'x' ? bounds.height : bounds.width;
  const allowed = Math.floor(crossLength * options.outlierRatio);
  let outliers = 0;
  for (let cross = crossStart; cross < crossStart + crossLength; cross += 1) {
    const a = axis === 'x' ? pixelOffset(raster, index, cross) : pixelOffset(raster, cross, index);
    const b = axis === 'x' ? pixelOffset(raster, other, cross) : pixelOffset(raster, cross, other);
    if (pixelDifference(raster, a, b) > options.tolerance) {
      outliers += 1;
      if (outliers > allowed) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Largest premultiplied pixel difference between two lines inside `bounds`.
 *
 * @evidence docs/spec.md#tiling-seams Measures how hard a non-repeating span jumps where it wraps.
 * @evidenceReview docs/spec.md#tiling-seams Read the section against this function and ran checksTilingSeams green with pnpm test.
 */
export function lineDistance(
  raster: Raster,
  axis: Axis,
  index: number,
  other: number,
  bounds: Rect,
): number {
  const crossStart = axis === 'x' ? bounds.y : bounds.x;
  const crossLength = axis === 'x' ? bounds.height : bounds.width;
  let max = 0;
  for (let cross = crossStart; cross < crossStart + crossLength; cross += 1) {
    const a = axis === 'x' ? pixelOffset(raster, index, cross) : pixelOffset(raster, cross, index);
    const b = axis === 'x' ? pixelOffset(raster, other, cross) : pixelOffset(raster, cross, other);
    max = Math.max(max, pixelDifference(raster, a, b));
  }
  return max;
}

/**
 * First adjacent pair inside `span` that does not match, as the index of the
 * first line of the pair, or undefined when the whole span is uniform.
 *
 * @evidence docs/spec.md#stretch-uniformity Locates the first mismatching pair inside a caller's stretch span.
 * @evidenceReview docs/spec.md#stretch-uniformity Read the section against this function and ran rejectsGivenInsetsThatStretchDetail green with pnpm test.
 */
export function firstMismatch(
  raster: Raster,
  axis: Axis,
  span: AxisSpan,
  bounds: Rect,
  options: MatchOptions,
): number | undefined {
  for (let index = span.start; index < span.end - 1; index += 1) {
    if (!linesMatch(raster, axis, index, index + 1, bounds, options)) {
      return index;
    }
  }
  return undefined;
}

/**
 * Longest run of matching lines inside `bounds`, or undefined when no adjacent
 * pair matches. Ties prefer the run covering the center, then the nearest one.
 *
 * @evidence docs/spec.md#stretch-detection Picks the longest uniform run with the center-first tie break.
 * @evidenceReview docs/spec.md#stretch-detection Read the section against this function and ran detectsPanelInsets green with pnpm test.
 */
export function detectStretchSpan(
  raster: Raster,
  axis: Axis,
  bounds: Rect,
  options: MatchOptions,
): AxisSpan | undefined {
  const start = axis === 'x' ? bounds.x : bounds.y;
  const length = axis === 'x' ? bounds.width : bounds.height;
  const center = start + (length - 1) / 2;
  let best: AxisSpan | undefined;
  let runStart: number | undefined;

  const consider = (span: AxisSpan): void => {
    if (best === undefined || isBetterSpan(span, best, center)) {
      best = span;
    }
  };

  for (let index = start; index < start + length - 1; index += 1) {
    if (linesMatch(raster, axis, index, index + 1, bounds, options)) {
      runStart ??= index;
    } else if (runStart !== undefined) {
      consider({ start: runStart, end: index + 1 });
      runStart = undefined;
    }
  }
  if (runStart !== undefined) {
    consider({ start: runStart, end: start + length });
  }
  return best;
}

function isBetterSpan(candidate: AxisSpan, current: AxisSpan, center: number): boolean {
  const candidateLength = candidate.end - candidate.start;
  const currentLength = current.end - current.start;
  if (candidateLength !== currentLength) {
    return candidateLength > currentLength;
  }
  return centerDistance(candidate, center) < centerDistance(current, center);
}

function centerDistance(span: AxisSpan, center: number): number {
  if (center >= span.start && center <= span.end - 1) {
    return 0;
  }
  return Math.min(Math.abs(span.start - center), Math.abs(span.end - 1 - center));
}
