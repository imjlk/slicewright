import { pixelDifference, pixelOffset, type Raster, type Rect } from './raster.js';
import type { SliceInsets } from './slices.js';

/** Fractions of the content at which the sample lines run. */
const sampleFractions = [0.4, 0.45, 0.5, 0.55, 0.6] as const;
/** The smallest step between neighbors that counts as the frame's inner edge. */
const minimumEdgeStep = 16;

/**
 * Where content such as text can sit inside the frame: from the center of the
 * content, each sample line walks outward until a neighbor step exceeds the
 * edge threshold, and the padding on each side is the median of where those
 * walks stop. A smooth fill or gradient never stops a walk; a frame's inner
 * edge does. A walk that reaches the image edge gives zero padding.
 *
 * @evidence docs/spec.md#content-padding Walks five sample lines outward from the center to the first strong neighbor step and takes the median per side.
 * @evidenceReview docs/spec.md#content-padding #3fc5743 Checked this code against the section line by line and ran detectsContentPadding green with pnpm test.
 */
export function detectContentPadding(
  raster: Raster,
  bounds: Rect,
  tolerance: { readonly x: number; readonly y: number },
): SliceInsets {
  const threshold = (axisTolerance: number): number => Math.max(minimumEdgeStep, axisTolerance * 2);
  const centerX = bounds.x + Math.floor(bounds.width / 2);
  const centerY = bounds.y + Math.floor(bounds.height / 2);
  const rows = sampleFractions.map((fraction) => bounds.y + Math.floor(bounds.height * fraction));
  const columns = sampleFractions.map((fraction) => bounds.x + Math.floor(bounds.width * fraction));

  // Walks from `start` by `step` and returns the last position still inside the fill.
  const walk = (
    start: number,
    step: -1 | 1,
    limit: number,
    at: (position: number) => number,
    edge: number,
  ): number => {
    let position = start;
    while (position + step >= 0 && position + step < limit) {
      if (pixelDifference(raster, at(position), at(position + step)) > edge) {
        return position;
      }
      position += step;
    }
    return position;
  };
  const median = (values: number[]): number => {
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] ?? 0;
  };

  const edgeX = threshold(tolerance.x);
  const edgeY = threshold(tolerance.y);
  const left = rows.map((y) =>
    walk(centerX, -1, raster.width, (x) => pixelOffset(raster, x, y), edgeX),
  );
  const right = rows.map((y) =>
    walk(centerX, 1, raster.width, (x) => pixelOffset(raster, x, y), edgeX),
  );
  const top = columns.map((x) =>
    walk(centerY, -1, raster.height, (y) => pixelOffset(raster, x, y), edgeY),
  );
  const bottom = columns.map((x) =>
    walk(centerY, 1, raster.height, (y) => pixelOffset(raster, x, y), edgeY),
  );
  return {
    left: median(left),
    right: raster.width - 1 - median(right),
    top: median(top),
    bottom: raster.height - 1 - median(bottom),
  };
}

/**
 * Returns why content padding cannot fit an image of this size, or undefined.
 *
 * @evidence docs/spec.md#content-padding Requires non-negative whole padding that leaves a content area at least one pixel wide.
 * @evidenceReview docs/spec.md#content-padding #3fc5743 Checked this code against the section line by line and ran detectsContentPadding green with pnpm test.
 */
export function paddingProblem(
  padding: SliceInsets,
  width: number,
  height: number,
): string | undefined {
  for (const [name, value] of Object.entries(padding)) {
    if (!Number.isInteger(value) || value < 0) {
      return `${name} padding must be a non-negative integer, got ${value}.`;
    }
  }
  if (padding.left + padding.right >= width || padding.top + padding.bottom >= height) {
    return `Content padding ${padding.left},${padding.right},${padding.top},${padding.bottom} leaves no content area in ${width}x${height}.`;
  }
  return undefined;
}
