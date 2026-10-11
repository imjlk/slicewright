import { createRaster, pixelOffset, type Raster, type Rect } from './raster.js';
import {
  flexibleSegments,
  layoutFromInsets,
  minimumLayoutSize,
  type AxisLayout,
  type Segment,
  type SliceLayout,
} from './layout.js';
import type { SliceInsets } from './slices.js';

export interface RenderOptions {
  readonly tileX: boolean;
  readonly tileY: boolean;
}

/** The cells a preview sheet can show, in sheet order. */
export const previewCellLabels = ['guides', 'source', 'min', 'wide', 'tall', 'double'] as const;
export type PreviewCellLabel = (typeof previewCellLabels)[number];

export interface PreviewCell extends Rect {
  readonly label: PreviewCellLabel;
}

export interface PreviewSheet {
  readonly raster: Raster;
  readonly cells: readonly PreviewCell[];
}

export interface PreviewOptions {
  /** Cells to show, in sheet order; every cell the layout allows when omitted. */
  readonly cells?: readonly PreviewCellLabel[];
  /** Whole-number nearest-neighbor scale for every cell, 1 to 8. */
  readonly zoom?: number;
  /** Width at which cells wrap to a new row; a wider cell sits alone in its row. */
  readonly maxWidth?: number;
}

/** Default row width: wide enough for most art, narrow enough for image viewers. */
export const defaultPreviewMaxWidth = 2048;
const maximumZoom = 8;
const maximumSheetSide = 16384;

const padding = 16;
const checkerSize = 8;
const maximumCellSize = 4096;
const tint = [255, 0, 200, 72] as const;
const contentOutline = [0, 220, 255, 255] as const;

/**
 * Renders insets at a new size; a thin wrapper over `renderLayout`.
 */
export function renderSlices(
  source: Raster,
  insets: SliceInsets,
  width: number,
  height: number,
  options: RenderOptions = { tileX: false, tileY: false },
): Raster {
  return renderLayout(
    source,
    layoutFromInsets(insets, source.width, source.height, {
      tile: { x: options.tileX, y: options.tileY },
    }),
    width,
    height,
  );
}

/**
 * Renders a layout at a new size, sampling the nearest source pixel. Fixed
 * segments keep their size; flexible segments share the remaining length in
 * proportion to their source size. Tiled segments repeat a whole number of
 * tiles, at least one, each scaled to fill the segment: the count rounds down
 * as Phaser does, or to the nearest whole number to match CSS `round`. A size
 * below the fixed segments is raised to them, and an axis with nothing
 * flexible keeps its source length.
 *
 * @evidence docs/spec.md#preview-sheet Keeps fixed segments unscaled, shares the rest among flexible segments, and tiles whole tiles with nearest sampling.
 * @evidenceReview docs/spec.md#preview-sheet #444784f Checked this code against the section line by line and ran rendersSlicesAndPreviewSheets green with pnpm test.
 * @evidence docs/spec.md#slice-layouts Renders any number of fixed, stretched, and tiled segments per axis.
 * @evidenceReview docs/spec.md#slice-layouts #fc52f65 Checked this code against the section line by line and ran describesSliceLayouts green with pnpm test.
 */
export function renderLayout(
  source: Raster,
  layout: SliceLayout,
  width: number,
  height: number,
  tileCount: 'floor' | 'round' = 'floor',
): Raster {
  for (const [name, value] of [
    ['width', width],
    ['height', height],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(`The ${name} to render must be a whole number of pixels, got ${value}.`);
    }
  }
  if (layout.x.length !== source.width || layout.y.length !== source.height) {
    throw new RangeError(
      `The layout is ${layout.x.length}x${layout.y.length} but the image is ${source.width}x${source.height}.`,
    );
  }
  const columns = axisMap(layout.x, width, tileCount);
  const rows = axisMap(layout.y, height, tileCount);
  const out = createRaster(columns.length, rows.length);
  rows.forEach((sourceY, y) => {
    columns.forEach((sourceX, x) => {
      const from = pixelOffset(source, sourceX, sourceY);
      out.data.set(source.data.subarray(from, from + 4), pixelOffset(out, x, y));
    });
  });
  return out;
}

/**
 * Lays the source, its tinted flexible segments with the content box outlined,
 * and several resized versions over a checkerboard, in rows that wrap at a
 * maximum width. Axes that cannot resize are not resized, so the cells that
 * would resize them are left out. The caller can choose cells and zoom every
 * cell by a whole number with nearest sampling.
 *
 * @evidence docs/spec.md#preview-sheet Builds the guides, source, minimum, wide, tall, and doubled cells, lets the caller pick and zoom them, and wraps rows at the maximum width.
 * @evidenceReview docs/spec.md#preview-sheet #444784f Checked this code against the section line by line and ran rendersSlicesAndPreviewSheets green with pnpm test.
 */
export function renderPreviewSheet(
  source: Raster,
  layout: SliceLayout,
  options: PreviewOptions = {},
): PreviewSheet {
  const zoom = options.zoom ?? 1;
  const maxWidth = options.maxWidth ?? defaultPreviewMaxWidth;
  if (!Number.isInteger(zoom) || zoom < 1 || zoom > maximumZoom) {
    throw new RangeError(
      `The preview zoom must be a whole number from 1 to ${maximumZoom}, got ${zoom}.`,
    );
  }
  if (!Number.isInteger(maxWidth) || maxWidth < 1) {
    throw new RangeError(`The preview width must be a positive whole number, got ${maxWidth}.`);
  }
  const cap = (value: number): number => Math.min(Math.round(value), maximumCellSize);
  const minimum = minimumLayoutSize(layout);
  const resizesX = flexibleSegments(layout.x).length > 0;
  const resizesY = flexibleSegments(layout.y).length > 0;
  const available = new Map<PreviewCellLabel, readonly [number, number]>([
    ['guides', [source.width, source.height]],
    ['source', [source.width, source.height]],
    ['min', [Math.max(minimum.width, 1), Math.max(minimum.height, 1)]],
  ]);
  if (resizesX) {
    available.set('wide', [cap(source.width * 2.5), source.height]);
  }
  if (resizesY) {
    available.set('tall', [source.width, cap(source.height * 2.5)]);
  }
  available.set('double', [
    resizesX ? cap(source.width * 2) : source.width,
    resizesY ? cap(source.height * 2) : source.height,
  ]);

  const requested = options.cells ?? previewCellLabels.filter((label) => available.has(label));
  const unavailable = requested.filter((label) => !available.has(label));
  if (unavailable.length > 0) {
    const reasons = unavailable.map(
      (label) => `${label} (the ${label === 'wide' ? 'width' : 'height'} does not resize)`,
    );
    throw new RangeError(`This layout has no ${reasons.join(' or ')} cell.`);
  }
  const labels = previewCellLabels.filter((label) => requested.includes(label));
  if (labels.length === 0) {
    throw new RangeError('A preview sheet needs at least one cell.');
  }
  for (const label of labels) {
    const [width, height] = available.get(label) ?? [0, 0];
    if (Math.max(width, height) * zoom > maximumSheetSide) {
      throw new RangeError(
        `The ${label} cell would be ${width * zoom}x${height * zoom} at zoom ${zoom}; lower the zoom.`,
      );
    }
  }

  const rendered = labels.map((label) => {
    const [width, height] = available.get(label) ?? [0, 0];
    const raster =
      label === 'guides'
        ? outlineContent(tintSegments(source, layout), layout.content)
        : renderLayout(source, layout, width, height);
    return { label, raster: zoomRaster(raster, zoom) };
  });

  // Rows wrap before a cell that would cross the maximum width.
  const placed: Array<{ label: PreviewCellLabel; raster: Raster; x: number; y: number }> = [];
  let x = padding;
  let y = padding;
  let rowHeight = 0;
  for (const cell of rendered) {
    if (x > padding && x + cell.raster.width + padding > maxWidth) {
      x = padding;
      y += rowHeight + padding;
      rowHeight = 0;
    }
    placed.push({ ...cell, x, y });
    x += cell.raster.width + padding;
    rowHeight = Math.max(rowHeight, cell.raster.height);
  }
  const sheetWidth = Math.max(...placed.map((cell) => cell.x + cell.raster.width + padding));
  const sheetHeight = y + rowHeight + padding;
  const sheet = checkerboard(sheetWidth, sheetHeight);
  const cells: PreviewCell[] = placed.map((cell) => {
    composite(sheet, cell.raster, cell.x, cell.y);
    return {
      label: cell.label,
      x: cell.x,
      y: cell.y,
      width: cell.raster.width,
      height: cell.raster.height,
    };
  });
  return { raster: sheet, cells };
}

/** Scales a raster up by a whole number, repeating each pixel. */
function zoomRaster(raster: Raster, zoom: number): Raster {
  if (zoom === 1) {
    return raster;
  }
  const out = createRaster(raster.width * zoom, raster.height * zoom);
  for (let y = 0; y < out.height; y += 1) {
    for (let x = 0; x < out.width; x += 1) {
      const from = pixelOffset(raster, Math.floor(x / zoom), Math.floor(y / zoom));
      out.data.set(raster.data.subarray(from, from + 4), pixelOffset(out, x, y));
    }
  }
  return out;
}

/** For each output line of one axis, the source line it samples. */
function axisMap(axis: AxisLayout, requested: number, tileCount: 'floor' | 'round'): number[] {
  const flexible = flexibleSegments(axis);
  const fixedLength = axis.segments
    .filter((segment) => segment.kind === 'fixed')
    .reduce((sum, segment) => sum + segment.end - segment.start, 0);
  if (flexible.length === 0) {
    return Array.from({ length: axis.length }, (_, index) => index);
  }
  const outLength = Math.max(requested, fixedLength, 1);
  const extra = outLength - fixedLength;
  const flexibleSource = flexible.reduce((sum, segment) => sum + segment.end - segment.start, 0);
  const map: number[] = [];
  let shared = 0;
  let given = 0;
  for (const segment of axis.segments) {
    const sourceLength = segment.end - segment.start;
    if (segment.kind === 'fixed') {
      for (let index = 0; index < sourceLength; index += 1) {
        map.push(segment.start + index);
      }
      continue;
    }
    shared += sourceLength;
    const boundary = Math.round((extra * shared) / flexibleSource);
    const length = boundary - given;
    given = boundary;
    const count = tileCount === 'round'
      ? Math.round(length / sourceLength)
      : Math.floor(length / sourceLength);
    const tiles = segment.kind === 'tile' ? Math.max(1, count) : 1;
    const tileLength = length / tiles;
    for (let index = 0; index < length; index += 1) {
      const local = (index + 0.5) % tileLength;
      map.push(
        segment.start + Math.min(sourceLength - 1, Math.floor((local * sourceLength) / tileLength)),
      );
    }
  }
  return map;
}

function tintSegments(source: Raster, layout: SliceLayout): Raster {
  const out = createRaster(source.width, source.height);
  out.data.set(source.data);
  const flexibleX = flexibleSegments(layout.x);
  const flexibleY = flexibleSegments(layout.y);
  const inside = (segments: readonly Segment[], position: number): boolean =>
    segments.some((segment) => position >= segment.start && position < segment.end);
  for (let y = 0; y < source.height; y += 1) {
    const inY = inside(flexibleY, y);
    for (let x = 0; x < source.width; x += 1) {
      const inX = inside(flexibleX, x);
      for (let pass = Number(inX) + Number(inY); pass > 0; pass -= 1) {
        blendPixel(out, x, y, tint);
      }
    }
  }
  return out;
}

/** Draws the content box, inside the padding, as a 1 px outline. */
function outlineContent(raster: Raster, padding: SliceInsets | null | undefined): Raster {
  if (padding === null || padding === undefined) {
    return raster;
  }
  const x0 = padding.left;
  const x1 = raster.width - padding.right - 1;
  const y0 = padding.top;
  const y1 = raster.height - padding.bottom - 1;
  if (x1 < x0 || y1 < y0) {
    return raster;
  }
  for (let x = x0; x <= x1; x += 1) {
    raster.data.set(contentOutline, pixelOffset(raster, x, y0));
    raster.data.set(contentOutline, pixelOffset(raster, x, y1));
  }
  for (let y = y0; y <= y1; y += 1) {
    raster.data.set(contentOutline, pixelOffset(raster, x0, y));
    raster.data.set(contentOutline, pixelOffset(raster, x1, y));
  }
  return raster;
}

function checkerboard(width: number, height: number): Raster {
  const out = createRaster(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const light = (Math.floor(x / checkerSize) + Math.floor(y / checkerSize)) % 2 === 0;
      const value = light ? 236 : 204;
      out.data.set([value, value, value, 255], pixelOffset(out, x, y));
    }
  }
  return out;
}

function composite(target: Raster, layer: Raster, left: number, top: number): void {
  for (let y = 0; y < layer.height; y += 1) {
    for (let x = 0; x < layer.width; x += 1) {
      const from = pixelOffset(layer, x, y);
      blendPixel(target, left + x, top + y, [
        layer.data[from] ?? 0,
        layer.data[from + 1] ?? 0,
        layer.data[from + 2] ?? 0,
        layer.data[from + 3] ?? 0,
      ]);
    }
  }
}

function blendPixel(
  target: Raster,
  x: number,
  y: number,
  color: readonly [number, number, number, number],
): void {
  const offset = pixelOffset(target, x, y);
  const alpha = color[3] / 255;
  const baseAlpha = (target.data[offset + 3] ?? 0) / 255;
  const outAlpha = alpha + baseAlpha * (1 - alpha);
  if (outAlpha === 0) {
    return;
  }
  for (let channel = 0; channel < 3; channel += 1) {
    const base = target.data[offset + channel] ?? 0;
    target.data[offset + channel] = Math.round(
      ((color[channel] ?? 0) * alpha + base * baseAlpha * (1 - alpha)) / outAlpha,
    );
  }
  target.data[offset + 3] = Math.round(outAlpha * 255);
}
