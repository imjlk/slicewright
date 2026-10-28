import type { BrowserSnapshot } from './browser.js';
import { checkedRect } from './browser-validation.js';
import { createRaster, pixelDifference, type RasterDifference, type Rect } from './raster.js';

/** Explicit image-local CSS rectangles, never automatically inferred from text. */
export interface BrowserPixelRegion {
  readonly name: string;
  readonly bounds: readonly Rect[];
  readonly pixels: RasterDifference;
}

export interface BrowserPixelRegionResult extends BrowserPixelRegion {
  readonly pixelBounds: readonly Rect[];
  readonly samples: number;
  readonly difference: RasterDifference;
  readonly alphaChanges: number;
  readonly ok: boolean;
}

export interface BrowserPixelPolicyReport {
  readonly regions: readonly BrowserPixelRegionResult[];
  readonly outside: {
    readonly samples: number;
    readonly difference: RasterDifference;
    readonly alphaChanges: number;
    readonly ok: boolean;
  };
}

/**
 * @evidenceReview docs/spec.md#browser-regional-pixel-policies #17cfb4a Read the spec and implementation of outward rounding, single pixel ownership, regional statistics, exact alpha, strict outside results and dimension mismatch handling.
 * @evidence docs/spec.md#browser-regional-pixel-policies Validates explicit image-local regions, assigns each touched pixel once, and compares regional budgets with exact alpha and outside guards.
 */
export function compareBrowserPixelRegions(
  actual: BrowserSnapshot,
  reference: BrowserSnapshot,
  regions: readonly BrowserPixelRegion[],
): BrowserPixelPolicyReport | undefined {
  if (regions.length === 0) {
    throw new TypeError('Pixel regions must not be empty.');
  }
  const { width, height } = actual.raster;
  const owners = new Uint32Array(width * height);
  const names = new Set<string>();
  const rounded = regions.map((region, index) => {
    if (region.name.trim() === '' || names.has(region.name)) {
      throw new TypeError('Pixel region names must be nonblank and unique.');
    }
    names.add(region.name);
    for (const value of Object.values(region.pixels)) {
      if (!Number.isFinite(value) || value < 0 || value > 255) {
        throw new RangeError('Regional pixel tolerances must be finite and between 0 and 255.');
      }
    }
    if (region.bounds.length === 0) {
      throw new TypeError(`Pixel region ${region.name} needs bounds.`);
    }
    return region.bounds.map((bounds) => {
      checkedRect(bounds, `Pixel region ${region.name}`, true);
      if (bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > width ||
        bounds.y + bounds.height > height) {
        throw new RangeError(`Pixel region ${region.name} lies outside the captured image.`);
      }
      const x = Math.floor(bounds.x);
      const y = Math.floor(bounds.y);
      const right = Math.ceil(bounds.x + bounds.width);
      const bottom = Math.ceil(bounds.y + bounds.height);
      if (right <= x || bottom <= y) {
        throw new RangeError('Pixel region bounds must cover at least one representable pixel.');
      }
      for (let row = y; row < bottom; row += 1) {
        for (let column = x; column < right; column += 1) {
          const at = row * width + column;
          if (owners[at] !== 0) {
            throw new RangeError('Pixel region bounds overlap after rounding to touched pixels.');
          }
          owners[at] = index + 1;
        }
      }
      return { x, y, width: right - x, height: bottom - y };
    });
  });
  if (width !== reference.raster.width || height !== reference.raster.height) {
    return undefined;
  }
  const differences: number[][] = Array.from({ length: regions.length + 1 }, () => []);
  const alphaChanges = new Uint32Array(regions.length + 1);
  const pair = createRaster(2, 1);
  for (let pixel = 0; pixel < owners.length; pixel += 1) {
    const owner = owners[pixel] ?? 0;
    const at = pixel * 4;
    pair.data.set(actual.raster.data.subarray(at, at + 4), 0);
    pair.data.set(reference.raster.data.subarray(at, at + 4), 4);
    differences[owner]?.push(pixelDifference(pair, 0, 4));
    if (actual.raster.data[at + 3] !== reference.raster.data[at + 3]) {
      alphaChanges[owner] = (alphaChanges[owner] ?? 0) + 1;
    }
  }
  const statistics = differences.map((values) => {
    const samples = values.length;
    values.sort((a, b) => a - b);
    return {
      samples,
      difference: {
        mean: samples === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / samples,
        p99: values[Math.min(samples - 1, Math.floor(samples * 0.99))] ?? 0,
        max: values[samples - 1] ?? 0,
      },
    };
  });
  const outside = statistics[0];
  if (outside === undefined) {
    throw new Error('Missing outside pixel statistics.');
  }
  return {
    outside: {
      ...outside,
      alphaChanges: alphaChanges[0] ?? 0,
      ok: outside.difference.max === 0 && alphaChanges[0] === 0,
    },
    regions: regions.map((region, index) => {
      const result = statistics[index + 1];
      const pixelBounds = rounded[index];
      if (result === undefined || pixelBounds === undefined) {
        throw new Error('Missing region statistics.');
      }
      const alpha = alphaChanges[index + 1] ?? 0;
      return {
        ...structuredClone(region),
        pixelBounds,
        ...result,
        alphaChanges: alpha,
        ok: alpha === 0 && (['mean', 'p99', 'max'] as const).every((key) => result.difference[key] <= region.pixels[key]),
      };
    }),
  };
}
