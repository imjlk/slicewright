import { createRaster, pixelOffset, type Raster } from '../src/raster.js';

export type Color = readonly [number, number, number, number];

export const outline: Color = [40, 30, 20, 255];
export const rim: Color = [180, 140, 90, 255];
export const fill: Color = [90, 60, 40, 255];
export const ornament: Color = [240, 200, 60, 255];
export const clear: Color = [0, 0, 0, 0];

export function setPixel(raster: Raster, x: number, y: number, color: Color): void {
  raster.data.set(color, pixelOffset(raster, x, y));
}

export function fillRect(
  raster: Raster,
  x: number,
  y: number,
  width: number,
  height: number,
  color: Color,
): void {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      setPixel(raster, column, row, color);
    }
  }
}

/**
 * A panel with a 2 px outline, a 4 px rim, a flat fill, and an ornament pixel
 * in each corner, so the stretch span is everything inside the 6 px border.
 */
export function panel(width: number, height: number, margin = 0): Raster {
  const raster = createRaster(width + margin * 2, height + margin * 2);
  const x = margin;
  const y = margin;
  fillRect(raster, x, y, width, height, outline);
  fillRect(raster, x + 2, y + 2, width - 4, height - 4, rim);
  fillRect(raster, x + 6, y + 6, width - 12, height - 12, fill);
  for (const [cx, cy] of [
    [x + 3, y + 3],
    [x + width - 4, y + 3],
    [x + 3, y + height - 4],
    [x + width - 4, y + height - 4],
  ] as const) {
    setPixel(raster, cx, cy, ornament);
  }
  return raster;
}

/** A bar whose rows shade from light to dark, with 5 px capped ends. */
export function shadedBar(width: number, height: number): Raster {
  const raster = createRaster(width, height);
  for (let y = 0; y < height; y += 1) {
    const shade = 220 - Math.round((y * 160) / Math.max(1, height - 1));
    fillRect(raster, 0, y, width, 1, [shade, shade, 255, 255]);
  }
  fillRect(raster, 0, 0, 5, height, outline);
  fillRect(raster, width - 5, 0, 5, height, outline);
  setPixel(raster, 2, 2, ornament);
  setPixel(raster, width - 3, 2, ornament);
  return raster;
}

/** A horizontal gradient that never repeats a column. */
export function horizontalGradient(width: number, height: number): Raster {
  const raster = createRaster(width, height);
  for (let x = 0; x < width; x += 1) {
    const shade = Math.round((x * 255) / Math.max(1, width - 1));
    fillRect(raster, x, 0, 1, height, [shade, 0, 255 - shade, 255]);
  }
  return raster;
}

export function sameRaster(a: Raster, b: Raster): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.data.length === b.data.length &&
    a.data.every((value, index) => value === b.data[index])
  );
}
