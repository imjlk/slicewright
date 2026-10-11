import { createRaster, pixelOffset, type Raster, type Rect } from './raster.js';
import type { SliceInsets, SliceMode } from './slices.js';

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
 * Renders the slice layout at a new size, sampling the nearest source pixel.
 * Sizes below the fixed borders are raised to them, as Phaser does.
 *
 * @evidence docs/spec.md#preview-sheet Keeps corners unscaled and stretches or tiles spans with nearest sampling.
 * @evidenceReview docs/spec.md#preview-sheet Read the section against this function and ran rendersSlicesAndPreviewSheets green with pnpm test.
 */
export function renderSlices(
  source: Raster,
  insets: SliceInsets,
  width: number,
  height: number,
  options: RenderOptions = { tileX: false, tileY: false },
): Raster {
  const outWidth = Math.max(width, insets.left + insets.right, 1);
  const outHeight = Math.max(height, insets.top + insets.bottom, 1);
  const out = createRaster(outWidth, outHeight);
  const columns = Array.from({ length: outWidth }, (_, x) =>
    mapAxis(x, outWidth, source.width, insets.left, insets.right, options.tileX),
  );
  for (let y = 0; y < outHeight; y += 1) {
    const sy = mapAxis(y, outHeight, source.height, insets.top, insets.bottom, options.tileY);
    for (let x = 0; x < outWidth; x += 1) {
      const from = pixelOffset(source, columns[x] ?? 0, sy);
      out.data.set(source.data.subarray(from, from + 4), pixelOffset(out, x, y));
    }
  }
  return out;
}

/**
 * Lays the source, its tinted stretch spans, and several stretched sizes side
 * by side over a checkerboard.
 *
 * @evidence docs/spec.md#preview-sheet Builds the guides, source, minimum, wide, tall, and doubled cells.
 * @evidenceReview docs/spec.md#preview-sheet Read the section against this function and ran rendersSlicesAndPreviewSheets green with pnpm test.
 */
export function renderPreviewSheet(
  source: Raster,
  insets: SliceInsets,
  mode: SliceMode,
  options: RenderOptions = { tileX: false, tileY: false },
): PreviewSheet {
  const cap = (value: number): number => Math.min(Math.round(value), maximumCellSize);
  const sizes: Array<[PreviewCell['label'], number, number]> = [
    ['guides', source.width, source.height],
    ['source', source.width, source.height],
    [
      'min',
      Math.max(insets.left + insets.right, 1),
      mode === 'three' ? source.height : Math.max(insets.top + insets.bottom, 1),
    ],
    ['wide', cap(source.width * 2.5), source.height],
  ];
  if (mode === 'nine') {
    sizes.push(['tall', source.width, cap(source.height * 2.5)]);
  }
  sizes.push([
    'double',
    cap(source.width * 2),
    mode === 'three' ? source.height : cap(source.height * 2),
  ]);

  const rendered = sizes.map(([label, width, height]) => ({
    label,
    raster:
      label === 'guides'
        ? tintSpans(source, insets, mode)
        : renderSlices(source, insets, width, height, options),
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

function mapAxis(
  position: number,
  outLength: number,
  sourceLength: number,
  startInset: number,
  endInset: number,
  tile: boolean,
): number {
  if (position < startInset) {
    return position;
  }
  if (position >= outLength - endInset) {
    return sourceLength - (outLength - position);
  }
  const span = sourceLength - startInset - endInset;
  const outSpan = outLength - startInset - endInset;
  const offset = position - startInset;
  if (!tile) {
    return startInset + Math.min(span - 1, Math.floor(((offset + 0.5) * span) / outSpan));
  }
  const tiles = Math.max(1, Math.round(outSpan / span));
  const tileLength = outSpan / tiles;
  const local = (offset + 0.5) % tileLength;
  return startInset + Math.min(span - 1, Math.floor((local * span) / tileLength));
}

function tintSpans(source: Raster, insets: SliceInsets, mode: SliceMode): Raster {
  const out = createRaster(source.width, source.height);
  out.data.set(source.data);
  for (let y = 0; y < source.height; y += 1) {
    const inY = mode === 'nine' && y >= insets.top && y < source.height - insets.bottom;
    for (let x = 0; x < source.width; x += 1) {
      const inX = x >= insets.left && x < source.width - insets.right;
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
