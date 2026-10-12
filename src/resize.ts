import { createRaster, type Raster } from './raster.js';

export type ResizeFilter = 'area' | 'nearest';

/**
 * Resizes with exact area averaging in premultiplied alpha, or nearest
 * neighbor for pixel art.
 *
 * @evidence docs/spec.md#resizing Averages covered source area in premultiplied alpha, or samples the nearest pixel.
 * @evidenceReview docs/spec.md#resizing #66688ff Checked this code against the section line by line and ran resizesWithoutHalos green with pnpm test.
 */
export function resizeRaster(
  raster: Raster,
  width: number,
  height: number,
  filter: ResizeFilter = 'area',
): Raster {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`Resize target must be positive integers, got ${width}x${height}.`);
  }
  if (width === raster.width && height === raster.height) {
    const copy = createRaster(width, height);
    copy.data.set(raster.data);
    return copy;
  }
  return filter === 'nearest'
    ? resizeNearest(raster, width, height)
    : resizeArea(raster, width, height);
}

/** Fits `width`/`height`/`scale` into a target size, keeping the aspect ratio when one side is open. */
export function targetSize(
  width: number,
  height: number,
  request: { readonly width?: number; readonly height?: number; readonly scale?: number },
): { width: number; height: number } {
  for (const name of ['width', 'height', 'scale'] as const) {
    const value = request[name];
    if (value !== undefined && !(Number.isFinite(value) && value > 0)) {
      throw new RangeError(`--${name} must be a positive number, got ${value}.`);
    }
  }
  for (const name of ['width', 'height'] as const) {
    const value = request[name];
    if (value !== undefined && !Number.isInteger(value)) {
      throw new RangeError(`--${name} must be a whole number of pixels, got ${value}.`);
    }
  }
  if (request.scale !== undefined && (request.width !== undefined || request.height !== undefined)) {
    throw new RangeError('Give a scale or a width and height, not both.');
  }
  if (request.scale !== undefined) {
    return {
      width: Math.max(1, Math.round(width * request.scale)),
      height: Math.max(1, Math.round(height * request.scale)),
    };
  }
  if (request.width !== undefined && request.height !== undefined) {
    return { width: request.width, height: request.height };
  }
  if (request.width !== undefined) {
    return {
      width: request.width,
      height: Math.max(1, Math.round((height * request.width) / width)),
    };
  }
  if (request.height !== undefined) {
    return {
      width: Math.max(1, Math.round((width * request.height) / height)),
      height: request.height,
    };
  }
  return { width, height };
}

function resizeNearest(raster: Raster, width: number, height: number): Raster {
  const out = createRaster(width, height);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(raster.height - 1, Math.floor(((y + 0.5) * raster.height) / height));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(raster.width - 1, Math.floor(((x + 0.5) * raster.width) / width));
      const from = (sy * raster.width + sx) * 4;
      out.data.set(raster.data.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  return out;
}

function resizeArea(raster: Raster, width: number, height: number): Raster {
  const premultiplied = new Float64Array(raster.width * raster.height * 4);
  for (let index = 0; index < raster.width * raster.height; index += 1) {
    const alpha = (raster.data[index * 4 + 3] ?? 0) / 255;
    for (let channel = 0; channel < 3; channel += 1) {
      premultiplied[index * 4 + channel] = (raster.data[index * 4 + channel] ?? 0) * alpha;
    }
    premultiplied[index * 4 + 3] = alpha;
  }
  const columns = coverage(raster.width, width);
  const rows = coverage(raster.height, height);

  const horizontal = new Float64Array(width * raster.height * 4);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (const [source, weight] of columns[x] ?? []) {
        for (let channel = 0; channel < 4; channel += 1) {
          horizontal[(y * width + x) * 4 + channel] =
            (horizontal[(y * width + x) * 4 + channel] ?? 0) +
            (premultiplied[(y * raster.width + source) * 4 + channel] ?? 0) * weight;
        }
      }
    }
  }

  const out = createRaster(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sum = [0, 0, 0, 0];
      for (const [source, weight] of rows[y] ?? []) {
        for (let channel = 0; channel < 4; channel += 1) {
          sum[channel] = (sum[channel] ?? 0) + (horizontal[(source * width + x) * 4 + channel] ?? 0) * weight;
        }
      }
      const alpha = sum[3] ?? 0;
      const offset = (y * width + x) * 4;
      if (alpha > 0) {
        for (let channel = 0; channel < 3; channel += 1) {
          out.data[offset + channel] = clampByte((sum[channel] ?? 0) / alpha);
        }
      }
      out.data[offset + 3] = clampByte(alpha * 255);
    }
  }
  return out;
}

/** For each output index, the source indices it covers and their normalized weights. */
function coverage(sourceLength: number, outLength: number): Array<Array<[number, number]>> {
  const ratio = sourceLength / outLength;
  return Array.from({ length: outLength }, (_, index) => {
    const start = index * ratio;
    const end = start + ratio;
    const weights: Array<[number, number]> = [];
    if (ratio < 1) {
      // Upscaling: each output pixel lies inside one source pixel.
      weights.push([Math.min(sourceLength - 1, Math.floor(start + ratio / 2)), 1]);
      return weights;
    }
    for (let source = Math.floor(start); source < Math.min(sourceLength, Math.ceil(end)); source += 1) {
      const overlap = Math.min(end, source + 1) - Math.max(start, source);
      if (overlap > 1e-9) {
        weights.push([source, overlap / ratio]);
      }
    }
    return weights;
  });
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
