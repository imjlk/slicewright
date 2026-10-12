import type { Finding } from './inspect.js';
import { pixelOffset, type Raster } from './raster.js';
import type { ResizeFilter } from './resize.js';

/** Fractions of the content at which the sample lines run, as content padding uses. */
const sampleFractions = [0.4, 0.45, 0.5, 0.55, 0.6] as const;
/** How far in from each edge a line is looked for, as a fraction of the length. */
const searchDepth = 0.25;
/** Neighbor difference that still continues a run of one color. */
const runTolerance = 40;
/** Difference from both sides that makes a run a drawn line. */
const lineContrast = 48;
/** A line is drawn in opaque pixels; lower alpha is the anti-aliased edge. */
const opaqueAlpha = 224;
/** Sample lines on a side that must agree before it is reported. */
const agreeingLines = 3;

type Side = 'left' | 'right' | 'top' | 'bottom';

/**
 * Predicts drawn lines a downscale will lose. Along five sample lines it walks
 * in from each edge, past the transparent margin and the anti-aliased ramp,
 * and finds the first opaque run of one color that differs from both
 * neighbors by more than the line contrast and is drawn straight onto the fill
 * (the next run reaches the end of the search). Area averaging leaves a line `width / factor` of its
 * contrast, so a line narrower than half the factor fades; nearest sampling can
 * drop a line narrower than the factor outright. A side is reported when at
 * least three of its five sample lines find such a line.
 *
 * @evidence docs/spec.md#normalization Finds outlines narrower than the downscale factor allows along five sample lines per side and warns when three agree.
 * @evidenceReview docs/spec.md#normalization #0cca4e9 Checked this code against the section line by line and ran normalizesGeneratedArt green with pnpm test.
 */
export function thinLineFindings(
  source: Raster,
  factor: { readonly x: number; readonly y: number },
  filter: ResizeFilter,
): Finding[] {
  const limit = (axisFactor: number): number => (filter === 'nearest'
    ? axisFactor
    : axisFactor / 2);
  const sides: Array<{ side: Side; widths: number[]; factor: number }> = [];
  const rows = sampleFractions.map((fraction) => Math.floor(source.height * fraction));
  const columns = sampleFractions.map((fraction) => Math.floor(source.width * fraction));
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
    if (axisFactor < 2) {
      return;
    }
    const widths = lines
      .map((line) => firstLineWidth(source, at(line), length, inward))
      .filter((width): width is number => width !== undefined && width < limit(axisFactor));
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
  const widest = Math.max(...sides.flatMap((side) => side.widths));
  const largestFactor = Math.max(...sides.map((side) => side.factor));
  return [
    {
      code: 'resize.thin-lines',
      severity: 'warning',
      message: `Lines up to ${widest} px wide along the ${sides.map((side) => side.side).join(', ')} edge${sides.length === 1 ? '' : 's'} shrink ${largestFactor.toFixed(1)} times and ${filter === 'nearest' ? 'can drop out' : 'fade into their neighbors'}. Ask for outlines at least ${Math.ceil(largestFactor)} px thick in the source, or normalize to a larger size.`,
      details: Object.fromEntries(sides.map((side) => [side.side, side.widths])),
    },
  ];
}

/**
 * Walks from one end of a line inward, past fully transparent pixels, and
 * returns the width of the first run that contrasts with both neighbors, or
 * undefined when none starts within the search depth.
 */
function firstLineWidth(
  raster: Raster,
  at: (position: number) => number,
  length: number,
  inward: 1 | -1,
): number | undefined {
  const start = inward === 1 ? 0 : length - 1;
  const depth = Math.floor(length * searchDepth);
  let position = start;
  const inside = (index: number): boolean => index >= 0 && index < length;
  // Skip the transparent margin and the anti-aliased ramp: a line is opaque.
  while (
    inside(position) &&
    Math.abs(position - start) < depth &&
    alphaOf(raster, at(position)) < opaqueAlpha
  ) {
    position += inward;
  }
  const reachesDepth = (from: number): boolean => {
    let index = from;
    while (
      inside(index + inward) &&
      Math.abs(index + inward - start) < depth &&
      alphaOf(raster, at(index + inward)) >= opaqueAlpha &&
      colorDifference(raster, at(index), at(index + inward)) <= runTolerance
    ) {
      index += inward;
    }
    return !inside(index + inward) || Math.abs(index + inward - start) >= depth;
  };
  // Outside the first opaque pixel counts as transparency.
  let before: number | undefined;
  while (inside(position) && Math.abs(position - start) < depth) {
    const runStart = position;
    while (
      inside(position + inward) &&
      Math.abs(position + inward - start) < depth &&
      alphaOf(raster, at(position + inward)) >= opaqueAlpha &&
      colorDifference(raster, at(position), at(position + inward)) <= runTolerance
    ) {
      position += inward;
    }
    const runEnd = position;
    // A run that fills the search window is the fill itself, not a line.
    if (!inside(runEnd + inward) || Math.abs(runEnd + inward - start) >= depth) {
      return undefined;
    }
    const after = inside(runEnd + inward) ? at(runEnd + inward) : undefined;
    const middle = at(runStart + Math.trunc((runEnd - runStart) / 2));
    const contrasts = (other: number | undefined): boolean =>
      other === undefined
        ? alphaOf(raster, middle) > lineContrast
        : alphaOf(raster, other) < opaqueAlpha
          ? alphaOf(raster, middle) - alphaOf(raster, other) > lineContrast
          : colorDifference(raster, middle, other) > lineContrast;
    if (after !== undefined && contrasts(before) && contrasts(after)) {
      // Only a line drawn straight onto the fill matters: when the run after it
      // reaches the end of the search, nothing else marks the border once the
      // line fades. A highlight on a thick rim leaves the rim.
      return reachesDepth(runEnd + inward) ? Math.abs(runEnd - runStart) + 1 : undefined;
    }
    before = at(runEnd);
    position = runEnd + inward;
  }
  return undefined;
}

/** Largest straight color channel difference; both pixels are opaque here. */
function colorDifference(raster: Raster, a: number, b: number): number {
  let max = 0;
  for (let channel = 0; channel < 3; channel += 1) {
    max = Math.max(max, Math.abs((raster.data[a + channel] ?? 0) - (raster.data[b + channel] ?? 0)));
  }
  return max;
}

function alphaOf(raster: Raster, offset: number): number {
  return raster.data[offset + 3] ?? 0;
}
