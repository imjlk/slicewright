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

/**
 * A bar whose rows are distinct bands, with 5 px capped ends. Adjacent rows
 * differ far beyond any noise tolerance and no row pattern repeats, so the bar
 * can neither stretch nor tile vertically.
 */
export function shadedBar(width: number, height: number): Raster {
  const raster = createRaster(width, height);
  // Rows 1 to 3 apart always differ by more than 24, so nothing repeats.
  const shades = [40, 220, 90, 180, 60, 250, 120, 30, 200, 150, 70, 240, 110, 10];
  for (let y = 0; y < height; y += 1) {
    const shade = shades[y % shades.length] ?? 0;
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

/** The raster turned a quarter turn: columns become rows. */
export function transpose(raster: Raster): Raster {
  const out = createRaster(raster.height, raster.width);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      out.data.set(
        raster.data.subarray(pixelOffset(raster, x, y), pixelOffset(raster, x, y) + 4),
        pixelOffset(out, y, x),
      );
    }
  }
  return out;
}

/** A panel with a crest in the middle of its top edge, which must not stretch. */
export function crestPanel(width: number, height: number): Raster {
  const raster = panel(width, height);
  const center = Math.floor(width / 2);
  // Every crest column differs, as drawn detail does, so none of it stretches.
  for (let x = 0; x < 10; x += 1) {
    fillRect(raster, center - 5 + x, 0, 1, 9, [240, 120 + x * 12, 60, 255]);
  }
  return raster;
}

/** A panel whose top and bottom borders carry a rope pattern repeating every 6 px. */
export function ropePanel(width: number, height: number): Raster {
  const raster = panel(width, height);
  for (let x = 6; x < width - 6; x += 1) {
    const color: Color = x % 6 < 3 ? [230, 190, 60, 255] : [120, 80, 20, 255];
    fillRect(raster, x, 2, 1, 3, color);
    fillRect(raster, x, height - 5, 1, 3, color);
  }
  return raster;
}
