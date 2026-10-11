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

export interface PreviewCell extends Rect {
  readonly label: 'guides' | 'source' | 'min' | 'wide' | 'tall' | 'double';
}

export interface PreviewSheet {
  readonly raster: Raster;
  readonly cells: readonly PreviewCell[];
}

const padding = 16;
const checkerSize = 8;
const maximumCellSize = 4096;
const tint = [255, 0, 200, 72] as const;

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
 * tiles, at least one, each scaled to fill the segment, as Phaser does. A size
 * below the fixed segments is raised to them, and an axis with nothing
 * flexible keeps its source length.
 *
 * @evidence docs/spec.md#preview-sheet Keeps fixed segments unscaled, shares the rest among flexible segments, and tiles whole tiles with nearest sampling.
 * @evidenceReview docs/spec.md#preview-sheet #b10124e Checked this code against the section line by line and ran rendersSlicesAndPreviewSheets green with pnpm test.
 * @evidence docs/spec.md#slice-layouts Renders any number of fixed, stretched, and tiled segments per axis.
 * @evidenceReview docs/spec.md#slice-layouts #b1ab6bb Checked this code against the section line by line and ran describesSliceLayouts green with pnpm test.
 */
export function renderLayout(
  source: Raster,
  layout: SliceLayout,
  width: number,
  height: number,
): Raster {
  const columns = axisMap(layout.x, width);
  const rows = axisMap(layout.y, height);
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
 * Lays the source, its tinted flexible segments, and several resized versions
 * side by side over a checkerboard. Axes that cannot resize are not resized.
 *
 * @evidence docs/spec.md#preview-sheet Builds the guides, source, minimum, wide, tall, and doubled cells.
 * @evidenceReview docs/spec.md#preview-sheet #b10124e Checked this code against the section line by line and ran rendersSlicesAndPreviewSheets green with pnpm test.
 */
export function renderPreviewSheet(source: Raster, layout: SliceLayout): PreviewSheet {
  const cap = (value: number): number => Math.min(Math.round(value), maximumCellSize);
  const minimum = minimumLayoutSize(layout);
  const resizesX = flexibleSegments(layout.x).length > 0;
  const resizesY = flexibleSegments(layout.y).length > 0;
  const sizes: Array<[PreviewCell['label'], number, number]> = [
    ['guides', source.width, source.height],
    ['source', source.width, source.height],
    ['min', Math.max(minimum.width, 1), Math.max(minimum.height, 1)],
  ];
  if (resizesX) {
    sizes.push(['wide', cap(source.width * 2.5), source.height]);
  }
  if (resizesY) {
    sizes.push(['tall', source.width, cap(source.height * 2.5)]);
  }
  sizes.push([
    'double',
    resizesX ? cap(source.width * 2) : source.width,
    resizesY ? cap(source.height * 2) : source.height,
  ]);

  const rendered = sizes.map(([label, width, height]) => ({
    label,
    raster:
      label === 'guides' ? tintSegments(source, layout) : renderLayout(source, layout, width, height),
  }));

  const sheetWidth =
    padding + rendered.reduce((sum, cell) => sum + cell.raster.width + padding, 0);
  const sheetHeight = padding * 2 + Math.max(...rendered.map((cell) => cell.raster.height));
  const sheet = checkerboard(sheetWidth, sheetHeight);
  const cells: PreviewCell[] = [];
  let x = padding;
  for (const cell of rendered) {
    composite(sheet, cell.raster, x, padding);
    cells.push({
      label: cell.label,
      x,
      y: padding,
      width: cell.raster.width,
      height: cell.raster.height,
    });
    x += cell.raster.width + padding;
  }
  return { raster: sheet, cells };
}

/** For each output line of one axis, the source line it samples. */
function axisMap(axis: AxisLayout, requested: number): number[] {
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
    const tiles = segment.kind === 'tile' ? Math.max(1, Math.floor(length / sourceLength)) : 1;
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
