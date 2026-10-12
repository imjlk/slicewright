import { pixelOffset, type Raster } from './raster.js';

/** Fractions of the image at which the sample lines run. */
const sampleFractions = [0.4, 0.45, 0.5, 0.55, 0.6] as const;
/** How far from the first visible pixel the stroke may start, as a fraction of the length. */
const searchDepth = 0.25;
/** Stroke and inside colors must differ by this much for the run to be an outline. */
const strokeContrast = 48;
/** The stroke starts at the first pixel this opaque; lower alpha is the anti-aliased edge. */
const opaqueAlpha = 224;
/** Strokes that must be measured before a thickness is trusted. */
const minimumSamples = 3;

type Color = readonly [number, number, number, number];
const transparent: Color = [0, 0, 0, 0];

/**
 * Measures the outline's thickness perpendicular to the stroke. Along five
 * sample lines from each edge it starts at the first visible pixel (up to half
 * the line), passes the anti-aliased ramp, and takes the first opaque pixel,
 * within a quarter of the length, as the stroke's color and the line's center
 * as the inside's; the two must differ by more than 48. Through the stroke's middle it
 * measures the stroke across (h) and along the other axis (v) by coverage:
 * each pixel counts by how far its premultiplied color lies from the nearer
 * background (inside or transparency) toward the stroke color, so noise below
 * half the contrast never breaks a run and anti-aliased pixels count in part.
 * A straight stroke at any angle is `1 / sqrt(1 / h² + 1 / v²)` thick. Returns
 * the median, or undefined with fewer than three strokes.
 *
 * @evidence docs/spec.md#resizing Measures the outline by coverage against the stroke and inside colors, perpendicular to the stroke from horizontal and vertical runs, and takes the median over the sample lines.
 * @evidenceReview docs/spec.md#resizing #66688ff Checked this code against the section line by line and ran matchesOutlineThickness green with pnpm test.
 */
export function outlineThickness(raster: Raster): number | undefined {
  const thicknesses: number[] = [];
  const rows = [...new Set(sampleFractions.map((f) => Math.floor(raster.height * f)))];
  const columns = [...new Set(sampleFractions.map((f) => Math.floor(raster.width * f)))];
  const lines: Array<{ point: (position: number) => readonly [number, number]; length: number }> = [
    ...rows.map((y) => ({ point: (p: number) => [p, y] as const, length: raster.width })),
    ...columns.map((x) => ({ point: (p: number) => [x, p] as const, length: raster.height })),
  ];
  for (const { point, length } of lines) {
    for (const inward of [1, -1] as const) {
      const stroke = findStroke(raster, point, length, inward);
      if (stroke !== undefined) {
        thicknesses.push(thicknessAt(raster, stroke.x, stroke.y, stroke.color, stroke.inside));
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
 * Finds the first stroke along a line: its middle pixel and its color and the
 * inside color, or undefined when the line has no contrasting outline.
 */
function findStroke(
  raster: Raster,
  point: (position: number) => readonly [number, number],
  length: number,
  inward: 1 | -1,
): { x: number; y: number; color: Color; inside: Color } | undefined {
  const edge = inward === 1 ? 0 : length - 1;
  const within = (position: number): boolean => position >= 0 && position < length;
  const colorAt = (position: number): Color => {
    const [x, y] = point(position);
    return premultiplied(raster, x, y);
  };
  // A piece such as a tail may not reach the canvas edge on every line.
  let start = edge;
  while (within(start) && Math.abs(start - edge) < length / 2 && colorAt(start)[3] === 0) {
    start += inward;
  }
  const depth = Math.floor(length * searchDepth);
  let position = start;
  while (
    within(position) &&
    Math.abs(position - start) < depth &&
    colorAt(position)[3] < opaqueAlpha
  ) {
    position += inward;
  }
  // The inside is read at the line's center, so a thick stroke still has one.
  const insidePosition = Math.floor(length / 2);
  if (!within(position) || Math.abs(position - start) >= depth) {
    return undefined;
  }
  const color = colorAt(position);
  const inside = colorAt(insidePosition);
  if (difference(color, inside) <= strokeContrast) {
    return undefined;
  }
  // Walk across the stroke while pixels sit nearer the stroke than the inside.
  let end = position;
  while (
    within(end + inward) &&
    Math.abs(end + inward - position) < length / 2 &&
    coverage(colorAt(end + inward), color, inside) >= 0.5
  ) {
    end += inward;
  }
  const middle = position + inward * Math.trunc(Math.abs(end - position) / 2);
  const [x, y] = point(middle);
  return { x, y, color, inside };
}

/** Perpendicular stroke thickness from the coverage runs across and along a pixel. */
function thicknessAt(raster: Raster, x: number, y: number, stroke: Color, inside: Color): number {
  // Each pixel is a mix of the stroke and whichever background it lies nearer:
  // the inside fill, or transparency on the outer side.
  const covered = (cx: number, cy: number): number => {
    const color = premultiplied(raster, cx, cy);
    const againstInside = mix(color, stroke, inside);
    const againstOutside = mix(color, stroke, transparent);
    return (againstInside.residual <= againstOutside.residual
      ? againstInside
      : againstOutside).share;
  };
  const run = (dx: number, dy: number): number => {
    let length = 1;
    for (const sign of [1, -1]) {
      let cx = x + dx * sign;
      let cy = y + dy * sign;
      while (cx >= 0 && cy >= 0 && cx < raster.width && cy < raster.height) {
        const share = covered(cx, cy);
        if (share < 0.5) {
          // The pixel the stroke ends in counts by how much of it is stroke.
          length += share;
          break;
        }
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

/**
 * How much of a pixel is stroke, from 0 (the background color) to 1 (the
 * stroke color): its premultiplied color projected onto the line between them.
 */
function coverage(color: Color, stroke: Color, background: Color): number {
  return mix(color, stroke, background).share;
}

/** The pixel as a mix of stroke and background: the share, and how far off that line it lies. */
function mix(color: Color, stroke: Color, background: Color): { share: number; residual: number } {
  let dot = 0;
  let norm = 0;
  for (let channel = 0; channel < 4; channel += 1) {
    const span = (stroke[channel] ?? 0) - (background[channel] ?? 0);
    dot += ((color[channel] ?? 0) - (background[channel] ?? 0)) * span;
    norm += span * span;
  }
  const share = norm === 0 ? 0 : Math.min(1, Math.max(0, dot / norm));
  let residual = 0;
  for (let channel = 0; channel < 4; channel += 1) {
    const expected =
      (background[channel] ?? 0) + share * ((stroke[channel] ?? 0) - (background[channel] ?? 0));
    residual += ((color[channel] ?? 0) - expected) ** 2;
  }
  return { share, residual };
}

function difference(a: Color, b: Color): number {
  return Math.max(...a.map((value, channel) => Math.abs(value - (b[channel] ?? 0))));
}

function premultiplied(raster: Raster, x: number, y: number): Color {
  const offset = pixelOffset(raster, x, y);
  const alpha = raster.data[offset + 3] ?? 0;
  const scale = alpha / 255;
  return [
    (raster.data[offset] ?? 0) * scale,
    (raster.data[offset + 1] ?? 0) * scale,
    (raster.data[offset + 2] ?? 0) * scale,
    alpha,
  ];
}
