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
 * Bounds of the pixels whose alpha exceeds `alphaThreshold` (0 means not
 * fully transparent), or undefined when no pixel does.
 *
 * @evidence docs/spec.md#transparent-margins Finds the fully transparent border rows and columns.
 * @evidenceReview docs/spec.md#transparent-margins #5bcc022 Checked this code against the section line by line and ran warnsAboutTransparentMargins green with pnpm test.
 */
export function contentBounds(raster: Raster, alphaThreshold = 0): Rect | undefined {
  let minX = raster.width;
  let minY = raster.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      if (alphaAt(raster, x, y) > alphaThreshold) {
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
 * @evidenceReview docs/spec.md#stretch-detection #ff483ae Checked this code against the section line by line and ran detectsPanelInsets green with pnpm test.
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
  // Rounded up so a small ratio still forgives a pixel on short lines.
  const allowed = Math.ceil(crossLength * options.outlierRatio);
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
 * @evidenceReview docs/spec.md#tiling-seams #e6197a2 Checked this code against the section line by line and ran checksTilingSeams green with pnpm test.
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

/** Quantile of a line pair's interior pixel differences used as its noise score. */
const noiseQuantile = 0.98;

/**
 * Noise floor along one axis, in the units line matching uses: for each
 * adjacent line pair inside the central half of the content, the 98th
 * percentile of their pixel differences over the central half of the line;
 * the floor is the median over those pairs. Edges and corners stay out of the
 * sample, so a patterned border is not taken for noise.
 *
 * @evidence docs/spec.md#stretch-detection Estimates each axis's interior noise floor that raises its tolerance for generated art.
 * @evidenceReview docs/spec.md#stretch-detection #ff483ae Checked this code against the section line by line and ran detectsPanelInsets and toleratesGeneratedNoise green with pnpm test.
 */
export function estimateNoise(raster: Raster, bounds: Rect, axis: Axis): number {
  const quarter = (start: number, length: number): [number, number] => [
    start + Math.floor(length / 4),
    start + Math.ceil((length * 3) / 4),
  ];
  const [lineStart, lineEnd] =
    axis === 'x' ? quarter(bounds.x, bounds.width) : quarter(bounds.y, bounds.height);
  const [crossStart, crossEnd] =
    axis === 'x' ? quarter(bounds.y, bounds.height) : quarter(bounds.x, bounds.width);
  const crossLength = crossEnd - crossStart;
  if (lineEnd - lineStart < 2 || crossLength < 1) {
    return 0;
  }
  const scores: number[] = [];
  const differences = new Float64Array(crossLength);
  for (let index = lineStart; index < lineEnd - 1; index += 1) {
    for (let cross = 0; cross < crossLength; cross += 1) {
      const at = crossStart + cross;
      const a = axis === 'x' ? pixelOffset(raster, index, at) : pixelOffset(raster, at, index);
      const b =
        axis === 'x' ? pixelOffset(raster, index + 1, at) : pixelOffset(raster, at, index + 1);
      differences[cross] = pixelDifference(raster, a, b);
    }
    differences.sort();
    scores.push(
      differences[Math.min(crossLength - 1, Math.floor(crossLength * noiseQuantile))] ?? 0,
    );
  }
  scores.sort((a, b) => a - b);
  return scores[Math.floor(scores.length / 2)] ?? 0;
}

/**
 * First adjacent pair inside `span` that does not match, as the index of the
 * first line of the pair, or undefined when the whole span is uniform.
 *
 * @evidence docs/spec.md#stretch-uniformity Locates the first mismatching pair inside a caller's stretch span.
 * @evidenceReview docs/spec.md#stretch-uniformity #695468c Checked this code against the section line by line and ran rejectsGivenInsetsThatStretchDetail green with pnpm test.
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
 * @evidenceReview docs/spec.md#stretch-detection #ff483ae Checked this code against the section line by line and ran detectsPanelInsets green with pnpm test.
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

/**
 * Every run of matching lines inside `bounds` that is at least `minimum` lines
 * long, in order.
 *
 * @evidence docs/spec.md#multiple-stretch-regions Collects every matching run that reaches the minimum length.
 * @evidenceReview docs/spec.md#multiple-stretch-regions #f4dd501 Checked this code against the section line by line and ran detectsMultipleRegions green with pnpm test.
 */
export function detectStretchRuns(
  raster: Raster,
  axis: Axis,
  bounds: Rect,
  options: MatchOptions,
  minimum: number,
): AxisSpan[] {
  const start = axis === 'x' ? bounds.x : bounds.y;
  const length = axis === 'x' ? bounds.width : bounds.height;
  const runs: AxisSpan[] = [];
  let runStart: number | undefined;
  const close = (end: number): void => {
    if (runStart !== undefined && end - runStart >= minimum) {
      runs.push({ start: runStart, end });
    }
    runStart = undefined;
  };
  for (let index = start; index < start + length - 1; index += 1) {
    if (linesMatch(raster, axis, index, index + 1, bounds, options)) {
      runStart ??= index;
    } else {
      close(index + 1);
    }
  }
  close(start + length);
  return runs;
}

export interface RepeatSpan {
  readonly span: AxisSpan;
  readonly period: number;
}

/**
 * Longest span inside `bounds` whose lines repeat with a fixed period, trimmed
 * to whole periods and holding at least two. Ties prefer the shorter period,
 * then the span nearest the center.
 *
 * @evidence docs/spec.md#repeating-edges Finds the longest whole-period span for periods from 2 to a quarter of the content, at most 64.
 * @evidenceReview docs/spec.md#repeating-edges #795d113 Checked this code against the section line by line and ran tilesRepeatingEdges green with pnpm test.
 */
export function detectRepeatSpan(
  raster: Raster,
  axis: Axis,
  bounds: Rect,
  options: MatchOptions,
): RepeatSpan | undefined {
  const start = axis === 'x' ? bounds.x : bounds.y;
  const length = axis === 'x' ? bounds.width : bounds.height;
  const center = start + (length - 1) / 2;
  const limit = Math.min(64, Math.floor(length / 4));
  let best: RepeatSpan | undefined;
  for (let period = 2; period <= limit; period += 1) {
    let runStart: number | undefined;
    const close = (runEnd: number): void => {
      if (runStart === undefined) {
        return;
      }
      const covered = runEnd - runStart + period;
      const whole = Math.floor(covered / period) * period;
      // The leftover lines can sit on either side; keep the window whose
      // midpoint is nearest the center.
      const from = runStart;
      const midpointDistance = (offset: number): number =>
        Math.abs(from + offset + (whole - 1) / 2 - center);
      let offset = 0;
      for (let shift = 1; shift <= covered - whole; shift += 1) {
        if (midpointDistance(shift) < midpointDistance(offset)) {
          offset = shift;
        }
      }
      const candidate = {
        span: { start: from + offset, end: from + offset + whole },
        period,
      };
      runStart = undefined;
      if (whole < period * 2) {
        return;
      }
      const length = (item: RepeatSpan): number => item.span.end - item.span.start;
      // Periods ascend, so an equal span from a longer period never replaces a
      // shorter one; within one period the span nearer the center wins.
      if (
        best === undefined ||
        length(candidate) > length(best) ||
        (length(candidate) === length(best) &&
          candidate.period === best.period &&
          centerDistance(candidate.span, center) < centerDistance(best.span, center))
      ) {
        best = candidate;
      }
    };
    for (let index = start; index + period < start + length; index += 1) {
      if (linesMatch(raster, axis, index, index + period, bounds, options)) {
        runStart ??= index;
      } else {
        close(index);
      }
    }
    close(start + length - period);
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
