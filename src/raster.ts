/** Straight-alpha RGBA image, 8 bits per channel, rows top to bottom. */
export interface Raster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/** Inclusive-exclusive pixel rectangle. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function createRaster(width: number, height: number): Raster {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`Raster size must be positive integers, got ${width}x${height}.`);
  }
  return { width, height, data: new Uint8Array(width * height * 4) };
}

export function pixelOffset(raster: Raster, x: number, y: number): number {
  return (y * raster.width + x) * 4;
}

export function alphaAt(raster: Raster, x: number, y: number): number {
  return raster.data[pixelOffset(raster, x, y) + 3] ?? 0;
}

export function cropRaster(raster: Raster, rect: Rect): Raster {
  if (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.width > raster.width ||
    rect.y + rect.height > raster.height
  ) {
    throw new RangeError(
      `Crop ${rect.width}x${rect.height}+${rect.x}+${rect.y} is outside ${raster.width}x${raster.height}.`,
    );
  }
  const out = createRaster(rect.width, rect.height);
  for (let y = 0; y < rect.height; y += 1) {
    const start = pixelOffset(raster, rect.x, rect.y + y);
    out.data.set(raster.data.subarray(start, start + rect.width * 4), y * rect.width * 4);
  }
  return out;
}

/**
 * Largest premultiplied channel difference between two pixels, 0 to 255.
 * Premultiplying makes every fully transparent pixel equal regardless of its
 * hidden color.
 */
export function pixelDifference(raster: Raster, a: number, b: number): number {
  const data = raster.data;
  const alphaA = data[a + 3] ?? 0;
  const alphaB = data[b + 3] ?? 0;
  let max = Math.abs(alphaA - alphaB);
  for (let channel = 0; channel < 3; channel += 1) {
    const valueA = ((data[a + channel] ?? 0) * alphaA) / 255;
    const valueB = ((data[b + channel] ?? 0) * alphaB) / 255;
    const difference = Math.abs(valueA - valueB);
    if (difference > max) {
      max = difference;
    }
  }
  return max;
}
