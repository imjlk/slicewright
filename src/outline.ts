import { pixelDifference, pixelOffset, type Raster } from './raster.js';

/** Fractions of the image at which the sample lines run. */
const sampleFractions = [0.4, 0.45, 0.5, 0.55, 0.6] as const;
/** How far in from each edge the outline is looked for, as a fraction of the length. */
const searchDepth = 0.25;
/** Neighbor difference (premultiplied) that still continues one stroke. */
const strokeTolerance = 40;
/** Difference from what lies inside that makes the first opaque run a stroke. */
const strokeContrast = 48;
/** The stroke starts at the first pixel this opaque; lower alpha is the anti-aliased edge. */
const opaqueAlpha = 224;
/** Strokes that must be measured before a thickness is trusted. */
const minimumSamples = 3;

/**
 * Measures the outline's thickness perpendicular to the stroke. Along five
 * sample lines from each edge it walks past the transparent margin (up to half
 * the line) and the anti-aliased ramp to the first opaque run that contrasts with what lies
 * inside it: the outline. Through the run's middle pixel it measures the
 * stroke both across (h) and along the other axis (v); a straight stroke at
 * any angle is `1 / sqrt(1 / h² + 1 / v²)` thick, so slanted tail sides measure
 * like straight body sides. Returns the median, or undefined with fewer than
 * three strokes.
 *
 * @evidence docs/spec.md#resizing Measures the outline perpendicular to the stroke from horizontal and vertical runs and takes the median over the sample lines.
 * @evidenceReview docs/spec.md#resizing #d5f9f9d Checked this code against the section line by line and ran resizesWithoutHalos green with pnpm test.
 */
export function outlineThickness(raster: Raster): number | undefined {
  const thicknesses: number[] = [];
  const rows = [...new Set(sampleFractions.map((f) => Math.floor(raster.height * f)))];
  const columns = [...new Set(sampleFractions.map((f) => Math.floor(raster.width * f)))];
  for (const y of rows) {
    for (const inward of [1, -1] as const) {
      const x = strokeMiddle(raster, (p) => [p, y], raster.width, inward);
      if (x !== undefined) {
        thicknesses.push(thicknessAt(raster, x, y));
      }
    }
  }
  for (const x of columns) {
    for (const inward of [1, -1] as const) {
      const y = strokeMiddle(raster, (p) => [x, p], raster.height, inward);
      if (y !== undefined) {
        thicknesses.push(thicknessAt(raster, x, y));
      }
    }
  }
  if (thicknesses.length < minimumSamples) {
    return undefined;
  }
  thicknesses.sort((a, b) => a - b);
  return thicknesses[Math.floor(thicknesses.length / 2)];
}

/**
 * Returns the position of the middle of the first opaque stroke along a line,
 * or undefined when the first opaque run does not contrast with what follows
 * (no outline) or nothing opaque lies within the search depth.
 */
function strokeMiddle(
  raster: Raster,
  point: (position: number) => readonly [number, number],
  length: number,
  inward: 1 | -1,
): number | undefined {
  const edge = inward === 1 ? 0 : length - 1;
  const at = (position: number): number => {
    const [x, y] = point(position);
    return pixelOffset(raster, x, y);
  };
  const within = (position: number): boolean => position >= 0 && position < length;
  // A piece such as a tail may not reach the canvas edge on every line: the
  // search window starts at the first visible pixel, no further than halfway.
  let start = edge;
  while (within(start) && Math.abs(start - edge) < length / 2 && (raster.data[at(start) + 3] ?? 0) === 0) {
    start += inward;
  }
  const depth = Math.floor(length * searchDepth);
  const searching = (position: number): boolean =>
    within(position) && Math.abs(position - start) < depth;
  let position = start;
  while (searching(position) && (raster.data[at(position) + 3] ?? 0) < opaqueAlpha) {
    position += inward;
  }
  if (!searching(position)) {
    return undefined;
  }
  const runStart = position;
  while (
    searching(position + inward) &&
    pixelDifference(raster, at(position), at(position + inward)) <= strokeTolerance
  ) {
    position += inward;
  }
  if (!searching(position + inward)) {
    return undefined;
  }
  const middle = runStart + inward * Math.trunc(Math.abs(position - runStart) / 2);
  return pixelDifference(raster, at(middle), at(position + inward)) > strokeContrast
    ? middle
    : undefined;
}

/** Perpendicular stroke thickness from the horizontal and vertical runs through a pixel. */
function thicknessAt(raster: Raster, x: number, y: number): number {
  const center = pixelOffset(raster, x, y);
  const run = (dx: number, dy: number): number => {
    let length = 1;
    for (const sign of [1, -1]) {
      let cx = x + dx * sign;
      let cy = y + dy * sign;
      while (
        cx >= 0 &&
        cy >= 0 &&
        cx < raster.width &&
        cy < raster.height &&
        pixelDifference(raster, center, pixelOffset(raster, cx, cy)) <= strokeTolerance
      ) {
        length += 1;
        cx += dx * sign;
        cy += dy * sign;
      }
    }
    return length;
  };
  const h = run(1, 0);
  const v = run(0, 1);
  return 1 / Math.sqrt(1 / (h * h) + 1 / (v * v));
}
