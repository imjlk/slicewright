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
}

export interface PixelGrid {
  readonly x: PixelGridAxis;
  readonly y: PixelGridAxis;
  /** Share of visible pixels that differ from their cell's center, 0 when there is no grid. */
  readonly offGrid: number;
  /** Art size when every cell becomes one pixel. */
  readonly native: { readonly width: number; readonly height: number };
}

/** Adjacent lines differing by more than this (premultiplied, alpha included) are a boundary. */
const edgeThreshold = 24;
/** A pixel differing from its cell's center by more than this is off the grid. */
const cellTolerance = 24;
/** Boundaries must line up at least this well for a grid to count. */
const minimumFit = 0.85;
/** Fewer boundaries than this cannot show a grid. */
const minimumEdges = 6;
const minimumScale = 2;
const maximumScale = 32;
const scaleStep = 0.01;
/** Share of off-grid pixels above which a `pixel.off-grid` warning is given. */
export const offGridWarning = 0.1;

/**
 * Estimates the pixel grid of upscaled pixel art: along each axis, the
 * boundaries between differing adjacent lines inside `bounds` are matched
 * against every period from 2 to 32 source pixels; the largest period they
 * fit is the scale. Cells are then compared with their center pixel.
 *
 * @evidence docs/spec.md#pixel-grid Finds boundaries between lines, fits the largest period they agree on per axis, and measures off-grid pixels against each cell's center.
 * @evidenceReview docs/spec.md#pixel-grid #3d11372 Checked this code against the section line by line and ran detectsPixelGrid green with pnpm test.
 */
export function detectPixelGrid(raster: Raster, bounds?: Rect): PixelGrid {
  const area = bounds ?? { x: 0, y: 0, width: raster.width, height: raster.height };
  const x = fitAxis(boundaries(raster, 'x', area), area.width);
  const y = fitAxis(boundaries(raster, 'y', area), area.height);
  const gridded = x.scale > 1 || y.scale > 1;
  return {
    x,
    y,
    offGrid: gridded ? offGridShare(raster, area, x, y) : 0,
    native: {
      width: cellCenters(x, area.x, area.width).length,
      height: cellCenters(y, area.y, area.height).length,
    },
  };
}

/**
 * Resamples upscaled pixel art at its grid's cell centers, one pixel per cell,
 * so a fractional or offset grid still lands each art pixel exactly.
 *
 * @evidence docs/spec.md#pixel-grid Samples each cell's center pixel to rebuild the art at one pixel per cell.
 * @evidenceReview docs/spec.md#pixel-grid #3d11372 Checked this code against the section line by line and ran detectsPixelGrid green with pnpm test.
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
 * @evidence docs/spec.md#pixel-grid Reports an upscaled grid with its snap command, off-grid pixels as a warning, and no grid as a note.
 * @evidenceReview docs/spec.md#pixel-grid #3d11372 Checked this code against the section line by line and ran detectsPixelGrid green with pnpm test.
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
    message: `The art is upscaled about ${round(grid.x.scale)}x by ${round(grid.y.scale)}x; normalize --pixel-art snaps it to ${grid.native.width}x${grid.native.height}, or resize with --filter nearest.`,
    details,
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

/** Positions (in image coordinates) where line `i - 1` and line `i` differ. */
function boundaries(raster: Raster, axis: Axis, area: Rect): number[] {
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
  return merged(edges);
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
function fitAxis(edges: readonly number[], length: number): PixelGridAxis {
  const none = { scale: 1, offset: 0, edges: edges.length, fit: 0 };
  if (edges.length < minimumEdges) {
    return none;
  }
  const agreement = (period: number): { fit: number; phase: number } => {
    let sin = 0;
    let cos = 0;
    for (const edge of edges) {
      const angle = (2 * Math.PI * edge) / period;
      sin += Math.sin(angle);
      cos += Math.cos(angle);
    }
    return {
      fit: Math.hypot(sin, cos) / edges.length,
      phase: (Math.atan2(sin, cos) / (2 * Math.PI) + 1) % 1,
    };
  };
  // Every cell needs room to repeat a few times.
  const largest = Math.min(maximumScale, length / 3);
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
    return { scale, offset: phase * scale, edges: edges.length, fit };
  }
  return none;
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
