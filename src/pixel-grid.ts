import type { Finding } from './inspect.js';
import { createRaster, pixelDifference, pixelOffset, type Raster, type Rect } from './raster.js';

type Axis = 'x' | 'y';

/** The grid along one axis: source pixels per art pixel, and where the first cell starts. */
export interface PixelGridAxis {
  /** Source pixels per art pixel; 1 when the axis shows no coarser grid. */
  readonly scale: number;
  /** Position of a cell boundary, from 0 up to `scale`. */
  readonly offset: number;
  /** Line boundaries seen along the axis. */
  readonly edges: number;
  /** How closely the boundaries sit on the grid, 0 to 1. */
  readonly fit: number;
  /**
   * How the scale was found: `fit` from the boundaries' period, `spacing`
   * from the common divisor of a few boundaries' spacing, `given` by the
   * caller, `sparse` when too few boundaries leave the axis undetermined
   * (scale 1), and `none` when the boundaries show no grid.
   */
  readonly basis?: PixelGridBasis;
}

export type PixelGridBasis = 'fit' | 'spacing' | 'given' | 'sparse' | 'none';

export interface PixelGrid {
  readonly x: PixelGridAxis;
  readonly y: PixelGridAxis;
  /** Share of visible pixels that differ from their cell's center, 0 when there is no grid. */
  readonly offGrid: number;
  /** Art size when every cell becomes one pixel. */
  readonly native: { readonly width: number; readonly height: number };
  /**
   * When both axes have too few boundaries to tell a scale: the largest
   * scale every boundary (and the content's edges) lies on. The art may be
   * upscaled by it or any of its divisors, or be at its native size.
   */
  readonly candidate?: number;
}

/** Adjacent lines differing by more than this (premultiplied, alpha included) are a boundary. */
const edgeThreshold = 24;
/** A pixel differing from its cell's center by more than this is off the grid. */
const cellTolerance = 24;
/** Boundaries must line up at least this well for a grid to count. */
const minimumFit = 0.85;
/** A whole-number period fitting at least this well is an exact upscale. */
const exactFit = 0.99;
/** Fewer boundaries than this cannot show a grid. */
const minimumEdges = 6;
const minimumScale = 2;
const maximumScale = 32;
const scaleStep = 0.01;
/** Options for {@link detectPixelGrid}. */
export interface PixelGridOptions {
  /**
   * Source pixels per art pixel on both axes, when known; skips the search
   * and only places the grid. 1 means the art is at its native size.
   */
  readonly scale?: number;
}

/** Share of off-grid pixels above which a `pixel.off-grid` warning is given. */
export const offGridWarning = 0.1;

/**
 * Estimates the pixel grid of upscaled pixel art: along each axis, the
 * boundaries between differing adjacent lines inside `bounds` are matched
 * against every period from 2 to 32 source pixels; the largest period they
 * fit is the scale. Cells are then compared with their center pixel.
 *
 * @evidence docs/spec.md#pixel-grid Finds boundaries between lines, fits the largest period they agree on per axis, fills a sparse axis from the other axis's whole scale, leaves two sparse axes undetermined with a candidate scale, places a given scale, and measures off-grid pixels against each cell's center.
 * @evidenceReview docs/spec.md#pixel-grid #cf46969 Reread the section with the sparse-axis, differing-lines, candidate and given-scale rules and checked this code against it line by line; ran detectsPixelGrid and judgesSparsePixelGrid green with pnpm test.
 */
export function detectPixelGrid(
  raster: Raster,
  bounds?: Rect,
  options: PixelGridOptions = {},
): PixelGrid {
  const area = bounds ?? { x: 0, y: 0, width: raster.width, height: raster.height };
  const linesX = boundaries(raster, 'x', area);
  const linesY = boundaries(raster, 'y', area);
  const edgesX = linesX.edges;
  const edgesY = linesY.edges;
  let x: PixelGridAxis;
  let y: PixelGridAxis;
  let candidate: number | undefined;
  if (options.scale !== undefined) {
    const scale = options.scale;
    if (!Number.isFinite(scale) || scale < 1 || scale > area.width || scale > area.height) {
      throw new RangeError(
        `--pixel-scale must be a number from 1 to the content size (${area.width}x${area.height}), got ${scale}.`,
      );
    }
    x = givenAxis(edgesX, area.x, scale);
    y = givenAxis(edgesY, area.y, scale);
  } else {
    const spacingX = spacingScale(edgesX, area.x, area.width);
    const spacingY = spacingScale(edgesY, area.y, area.height);
    const fitX = fitAxis(linesX, area.width);
    const fitY = fitAxis(linesY, area.height);
    [x, y] = sparseAxes(fitX, fitY, spacingX, spacingY, area);
    if (x.basis === 'sparse' && y.basis === 'sparse') {
      candidate = sparseCandidate(x.edges + y.edges, spacingX, spacingY);
    }
  }
  const gridded = x.scale > 1 || y.scale > 1;
  return {
    x,
    y,
    offGrid: gridded ? offGridShare(raster, area, x, y) : 0,
    native: {
      width: cellCenters(x, area.x, area.width).length,
      height: cellCenters(y, area.y, area.height).length,
    },
    ...(candidate === undefined ? {} : { candidate }),
  };
}

/**
 * Resamples upscaled pixel art at its grid's cell centers, one pixel per cell,
 * so a fractional or offset grid still lands each art pixel exactly.
 *
 * @evidence docs/spec.md#pixel-grid Samples each cell's center pixel to rebuild the art at one pixel per cell.
 * @evidenceReview docs/spec.md#pixel-grid #cf46969 Reread the section with the sparse-axis, differing-lines, candidate and given-scale rules and checked this code against it line by line; ran detectsPixelGrid and judgesSparsePixelGrid green with pnpm test.
 */
export function snapToPixelGrid(raster: Raster, grid: PixelGrid): Raster {
  const xs = cellCenters(grid.x, 0, raster.width);
  const ys = cellCenters(grid.y, 0, raster.height);
  const out = createRaster(xs.length, ys.length);
  ys.forEach((sourceY, y) => {
    xs.forEach((sourceX, x) => {
      const from = pixelOffset(raster, sourceX, sourceY);
      out.data.set(raster.data.subarray(from, from + 4), pixelOffset(out, x, y));
    });
  });
  return out;
}

/**
 * Findings for art that should be pixel art: an upscaled grid to snap, and
 * cells that are not one flat color.
 *
 * @evidence docs/spec.md#pixel-grid Reports an upscaled grid with its snap command, off-grid pixels as a warning, no grid as a note, and an undetermined grid with its candidate scales.
 * @evidenceReview docs/spec.md#pixel-grid #cf46969 Reread the section with the sparse-axis, differing-lines, candidate and given-scale rules and checked this code against it line by line; ran detectsPixelGrid and judgesSparsePixelGrid green with pnpm test.
 */
export function pixelGridFindings(grid: PixelGrid): Finding[] {
  const findings: Finding[] = [];
  const details = {
    scale: { x: round(grid.x.scale), y: round(grid.y.scale) },
    offset: { x: round(grid.x.offset), y: round(grid.y.offset) },
    fit: { x: round(grid.x.fit), y: round(grid.y.fit) },
    native: grid.native,
    offGrid: round(grid.offGrid),
  };
  const basis = { x: grid.x.basis ?? 'fit', y: grid.y.basis ?? 'fit' };
  if (grid.x.scale === 1 && grid.y.scale === 1 && (basis.x === 'sparse' || basis.y === 'sparse')) {
    findings.push({
      code: 'pixel.grid-undetermined',
      severity: 'info',
      message: `Too few color edges (${grid.x.edges} across, ${grid.y.edges} down) to tell whether flat art like this is upscaled or at its native size${
        grid.candidate === undefined
          ? ''
          : `; every edge lies on a ${grid.candidate}-pixel grid, so the scale may be ${scaleChoices(grid.candidate)}`
      }. Give --pixel-scale with the scale the art was made at to snap it.`,
      details: { ...details, basis, ...(grid.candidate === undefined ? {} : { candidate: grid.candidate }) },
    });
    return findings;
  }
  if (grid.x.scale === 1 && grid.y.scale === 1) {
    findings.push({
      code: 'pixel.no-grid',
      severity: 'info',
      message:
        'No pixel grid coarser than one image pixel was found; the art is at its native size or not pixel art.',
      details,
    });
    return findings;
  }
  findings.push({
    code: 'pixel.upscaled',
    severity: 'info',
    message: `The art is upscaled about ${round(grid.x.scale)}x by ${round(grid.y.scale)}x; normalize ${basis.x === 'given' ? `--pixel-scale ${round(grid.x.scale)}` : '--pixel-art'} snaps it to ${grid.native.width}x${grid.native.height}, or resize with --filter nearest.${
      basis.x === 'spacing' || basis.y === 'spacing'
        ? ' One axis has few color edges, so its scale is the largest they and the other axis agree on; if the art pixels are smaller, give --pixel-scale.'
        : ''
    }`,
    details: { ...details, basis },
  });
  if (grid.offGrid > offGridWarning) {
    findings.push({
      code: 'pixel.off-grid',
      severity: 'warning',
      message: `${Math.round(grid.offGrid * 100)}% of pixels differ from their grid cell, from blur or anti-aliasing; snapping keeps each cell's center color only. Ask for crisp pixel art with no anti-aliasing.`,
      details,
    });
  }
  return findings;
}

/**
 * Positions (in image coordinates) where line `i - 1` and line `i` differ,
 * each run merged into one edge, and how many differing line pairs there were.
 */
function boundaries(
  raster: Raster,
  axis: Axis,
  area: Rect,
): { readonly edges: number[]; readonly lines: number } {
  const start = axis === 'x' ? area.x : area.y;
  const length = axis === 'x' ? area.width : area.height;
  const crossStart = axis === 'x' ? area.y : area.x;
  const crossLength = axis === 'x' ? area.height : area.width;
  const edges: number[] = [];
  for (let index = start + 1; index < start + length; index += 1) {
    for (let cross = crossStart; cross < crossStart + crossLength; cross += 1) {
      const a =
        axis === 'x'
          ? pixelOffset(raster, index - 1, cross)
          : pixelOffset(raster, cross, index - 1);
      const b = axis === 'x'
        ? pixelOffset(raster, index, cross)
        : pixelOffset(raster, cross, index);
      if (pixelDifference(raster, a, b) > edgeThreshold) {
        edges.push(index);
        break;
      }
    }
  }
  return { edges: merged(edges), lines: edges.length };
}

/** Collapses each run of adjacent boundaries, one blurred edge, into its middle. */
function merged(edges: readonly number[]): number[] {
  const out: number[] = [];
  let first = 0;
  for (let index = 1; index <= edges.length; index += 1) {
    if (index === edges.length || (edges[index] ?? 0) - (edges[index - 1] ?? 0) > 1) {
      out.push(((edges[first] ?? 0) + (edges[index - 1] ?? 0)) / 2);
      first = index;
    }
  }
  return out;
}

/**
 * The largest period the boundaries agree on. Agreement is the length of
 * the mean of each boundary's phase as a unit vector, so boundaries on a
 * whole multiple of the period score 1; a divisor of the true period also
 * scores 1, which is why the largest fitting period wins, and a multiple
 * scores low because half the boundaries fall between its cells.
 */
function fitAxis(
  { edges, lines }: { readonly edges: readonly number[]; readonly lines: number },
  length: number,
): PixelGridAxis {
  if (edges.length < minimumEdges) {
    // Few edges from many differing lines is detail at every pixel (or a
    // wide blur), not flat art.
    const basis = lines < minimumEdges ? 'sparse' : 'none';
    return { scale: 1, offset: 0, edges: edges.length, fit: 0, basis };
  }
  const none = { scale: 1, offset: 0, edges: edges.length, fit: 0, basis: 'none' } as const;
  const agreement = (period: number): { fit: number; phase: number } => phaseAgreement(
    edges,
    period,
  );
  // Every cell needs room to repeat a few times.
  const largest = Math.min(maximumScale, length / 3);
  // A whole-number upscale puts every boundary exactly on its grid; prefer
  // the largest such period over a fractional one that only fits loosely.
  for (let period = Math.floor(largest); period >= minimumScale; period -= 1) {
    const { fit, phase } = agreement(period);
    if (fit >= exactFit) {
      return { scale: period, offset: phase * period, edges: edges.length, fit, basis: 'fit' };
    }
  }
  for (let period = largest; period >= minimumScale; period -= scaleStep) {
    if (agreement(period).fit < minimumFit) {
      continue;
    }
    // The largest fitting period found; its best fit lies within the next half pixel.
    let best = period;
    let bestFit = 0;
    for (let near = period; near >= Math.max(minimumScale, period - 0.5); near -= scaleStep) {
      const { fit } = agreement(near);
      if (fit > bestFit) {
        best = near;
        bestFit = fit;
      }
    }
    const scale = snapScale(best);
    const { fit, phase } = agreement(scale);
    return { scale, offset: phase * scale, edges: edges.length, fit, basis: 'fit' };
  }
  return none;
}

/**
 * How closely boundaries agree on a period: the length of the mean of each
 * boundary's phase as a unit vector, and that mean phase.
 */
function phaseAgreement(edges: readonly number[], period: number): { fit: number; phase: number } {
  let sin = 0;
  let cos = 0;
  for (const edge of edges) {
    const angle = (2 * Math.PI * edge) / period;
    sin += Math.sin(angle);
    cos += Math.cos(angle);
  }
  return {
    fit: edges.length === 0 ? 1 : Math.hypot(sin, cos) / edges.length,
    phase: (Math.atan2(sin, cos) / (2 * Math.PI) + 1) % 1,
  };
}

/** A caller-given scale, placed where the boundaries agree best (or at the area's start). */
function givenAxis(edges: readonly number[], start: number, scale: number): PixelGridAxis {
  if (scale === 1) {
    return { scale: 1, offset: 0, edges: edges.length, fit: 1, basis: 'given' };
  }
  const { fit, phase } =
    edges.length === 0 ? { fit: 1, phase: (start % scale) / scale } : phaseAgreement(edges, scale);
  return { scale, offset: phase * scale, edges: edges.length, fit, basis: 'given' };
}

/**
 * The greatest common divisor of the spacing between crisp boundaries,
 * counting the area's ends as boundaries; undefined when a boundary is
 * blurred (not on a whole pixel).
 */
function spacingScale(edges: readonly number[], start: number, length: number): number | undefined {
  if (edges.some((edge) => !Number.isInteger(edge))) {
    return undefined;
  }
  const points = [start, ...edges, start + length];
  let divisor = 0;
  for (let index = 1; index < points.length; index += 1) {
    divisor = gcd(divisor, (points[index] ?? 0) - (points[index - 1] ?? 0));
  }
  return divisor;
}

/**
 * Fills in one axis with too few boundaries to fit a period from the other
 * axis. Art pixels are square, so the sparse axis takes the common divisor
 * of its own spacing and the other axis's whole scale; when the other axis
 * showed no grid at all the art has none. Two sparse axes stay undetermined.
 */
function sparseAxes(
  x: PixelGridAxis,
  y: PixelGridAxis,
  spacingX: number | undefined,
  spacingY: number | undefined,
  area: Rect,
): [PixelGridAxis, PixelGridAxis] {
  if (x.basis === 'none' || y.basis === 'none') {
    const none = (axis: PixelGridAxis): PixelGridAxis =>
      axis.basis === 'sparse' ? { ...axis, basis: 'none' } : axis;
    return [none(x), none(y)];
  }
  const settle = (
    axis: PixelGridAxis,
    own: number | undefined,
    other: PixelGridAxis,
    start: number,
  ): PixelGridAxis => {
    if (axis.basis !== 'sparse' || other.basis !== 'fit' || !Number.isInteger(other.scale)) {
      return axis;
    }
    const scale = own === undefined ? 1 : gcd(own, other.scale);
    if (scale < minimumScale) {
      return axis;
    }
    return { scale, offset: start % scale, edges: axis.edges, fit: 1, basis: 'spacing' };
  };
  return [settle(x, spacingX, y, area.x), settle(y, spacingY, x, area.y)];
}

/** The largest scale two sparse axes agree on, when there is any boundary to go by. */
function sparseCandidate(
  edges: number,
  spacingX: number | undefined,
  spacingY: number | undefined,
): number | undefined {
  if (edges === 0 || spacingX === undefined || spacingY === undefined) {
    // One flat block fits any scale that divides its size.
    return undefined;
  }
  const scale = gcd(spacingX, spacingY);
  return scale >= minimumScale && scale <= maximumScale ? scale : undefined;
}

/** "12, 6, 4, 3 or 2": a scale and its divisors from 2 up, largest first. */
function scaleChoices(scale: number): string {
  const choices: number[] = [];
  for (let divisor = scale; divisor >= minimumScale; divisor -= 1) {
    if (scale % divisor === 0) {
      choices.push(divisor);
    }
  }
  return choices.length === 1
    ? String(scale)
    : `${choices.slice(0, -1).join(', ')} or ${String(choices.at(-1))}`;
}

function gcd(a: number, b: number): number {
  let [larger, smaller] = [Math.abs(a), Math.abs(b)];
  while (smaller > 0) {
    [larger, smaller] = [smaller, larger % smaller];
  }
  return larger;
}

/** A period within 0.03 of a whole number is that number. */
function snapScale(period: number): number {
  const whole = Math.round(period);
  return Math.abs(period - whole) <= 0.03 ? whole : period;
}

/** Image coordinates of each cell's center along an axis, inside `start` to `start + length`. */
function cellCenters(grid: PixelGridAxis, start: number, length: number): number[] {
  if (grid.scale === 1) {
    return Array.from({ length }, (_, index) => start + index);
  }
  const centers: number[] = [];
  const first = Math.ceil((start - grid.offset) / grid.scale - 0.5);
  for (let cell = first; ; cell += 1) {
    const center = Math.floor(grid.offset + (cell + 0.5) * grid.scale);
    if (center >= start + length) {
      break;
    }
    if (center >= start) {
      centers.push(center);
    }
  }
  return centers;
}

function offGridShare(raster: Raster, area: Rect, x: PixelGridAxis, y: PixelGridAxis): number {
  let visible = 0;
  let off = 0;
  for (let row = area.y; row < area.y + area.height; row += 1) {
    const rows = nearbyCenters(y, row, area.y, area.height);
    for (let column = area.x; column < area.x + area.width; column += 1) {
      const at = pixelOffset(raster, column, row);
      if ((raster.data[at + 3] ?? 0) === 0) {
        continue;
      }
      visible += 1;
      const columns = nearbyCenters(x, column, area.x, area.width);
      // A fractional grid rounds its boundaries, so a pixel may belong to a neighbor cell.
      const matches = rows.some((centerY) =>
        columns.some(
          (centerX) =>
            pixelDifference(raster, at, pixelOffset(raster, centerX, centerY)) <= cellTolerance,
        ),
      );
      if (!matches) {
        off += 1;
      }
    }
  }
  return visible === 0 ? 0 : off / visible;
}

/** Centers of the cell holding `position` and its two neighbors, kept inside the area. */
function nearbyCenters(grid: PixelGridAxis, position: number, start: number, length: number): number[] {
  if (grid.scale === 1) {
    return [position];
  }
  const cell = Math.floor((position - grid.offset) / grid.scale);
  return [cell - 1, cell, cell + 1].map((index) =>
    Math.min(
      start + length - 1,
      Math.max(start, Math.floor(grid.offset + (index + 0.5) * grid.scale)),
    ),
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
