import { alphaAt, createRaster, pixelOffset, type Raster } from './raster.js';

export type ChromaKey = 'green' | 'magenta';

export interface ChromaOptions {
  /** Key color, or detect it from the border pixels. */
  readonly key: ChromaKey | 'auto';
  /** Key dominance at or below which a pixel stays opaque, 0 to 255. */
  readonly keep: number;
  /** Key dominance at or above which a pixel becomes transparent, 0 to 255. */
  readonly drop: number;
  /** Distance in pixels from transparency inside which tinted pixels are despilled. */
  readonly despillRadius: number;
}

export interface ChromaResult {
  readonly raster: Raster;
  readonly key: ChromaKey;
  readonly cleared: number;
  readonly softened: number;
  readonly despilled: number;
}

export const defaultChromaOptions: ChromaOptions = {
  key: 'auto',
  keep: 40,
  drop: 120,
  despillRadius: 2,
};

/** How strongly a pixel leans toward the key color, 0 when it does not. */
export function keyDominance(red: number, green: number, blue: number, key: ChromaKey): number {
  return key === 'green'
    ? Math.max(0, green - Math.max(red, blue))
    : Math.max(0, Math.min(red, blue) - green);
}

/**
 * Picks the key that dominates the image border, or undefined when neither
 * covers at least half of the border pixels.
 *
 * @evidence docs/spec.md#chroma-removal Detects the key from the border pixels before keying.
 * @evidenceReview docs/spec.md#chroma-removal #df13fe5 Checked this code against the section line by line and ran removesChromaBackgrounds green with pnpm test.
 */
export function detectChromaKey(raster: Raster, minimum = 120): ChromaKey | undefined {
  let border = 0;
  let green = 0;
  let magenta = 0;
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      if (x !== 0 && y !== 0 && x !== raster.width - 1 && y !== raster.height - 1) {
        continue;
      }
      border += 1;
      const offset = pixelOffset(raster, x, y);
      const [r = 0, g = 0, b = 0] = raster.data.subarray(offset, offset + 3);
      if (keyDominance(r, g, b, 'green') >= minimum) {
        green += 1;
      } else if (keyDominance(r, g, b, 'magenta') >= minimum) {
        magenta += 1;
      }
    }
  }
  if (green * 2 >= border) {
    return 'green';
  }
  if (magenta * 2 >= border) {
    return 'magenta';
  }
  return undefined;
}

/**
 * Keys out a green or magenta background and despills the new alpha edge.
 *
 * @evidence docs/spec.md#chroma-removal Clears, softens, and despills by key dominance.
 * @evidenceReview docs/spec.md#chroma-removal #df13fe5 Checked this code against the section line by line and ran removesChromaBackgrounds green with pnpm test.
 */
export function removeChroma(
  raster: Raster,
  options: ChromaOptions = defaultChromaOptions,
): ChromaResult {
  if (!(options.keep >= 0 && options.drop > options.keep && options.drop <= 255)) {
    throw new RangeError('Chroma thresholds need 0 <= keep < drop <= 255.');
  }
  const key = options.key === 'auto' ? detectChromaKey(raster) : options.key;
  if (key === undefined) {
    throw new Error(
      'No chroma key dominates the image border; pass the key explicitly or remove the background elsewhere.',
    );
  }

  const out = createRaster(raster.width, raster.height);
  out.data.set(raster.data);
  let cleared = 0;
  let softened = 0;
  for (let index = 0; index < out.data.length; index += 4) {
    const dominance = keyDominance(
      out.data[index] ?? 0,
      out.data[index + 1] ?? 0,
      out.data[index + 2] ?? 0,
      key,
    );
    if (dominance >= options.drop) {
      out.data.fill(0, index, index + 4);
      cleared += 1;
    } else if (dominance > options.keep) {
      const keep = (options.drop - dominance) / (options.drop - options.keep);
      out.data[index + 3] = Math.round((out.data[index + 3] ?? 0) * keep);
      softened += 1;
    }
  }

  const near = nearTransparency(out, options.despillRadius);
  let despilled = 0;
  for (let y = 0; y < out.height; y += 1) {
    for (let x = 0; x < out.width; x += 1) {
      if (alphaAt(out, x, y) === 0 || !near[y * out.width + x]) {
        continue;
      }
      const offset = pixelOffset(out, x, y);
      const r = out.data[offset] ?? 0;
      const g = out.data[offset + 1] ?? 0;
      const b = out.data[offset + 2] ?? 0;
      if (keyDominance(r, g, b, key) === 0) {
        continue;
      }
      if (key === 'green') {
        out.data[offset + 1] = Math.max(r, b);
      } else {
        const excess = Math.min(r, b) - g;
        out.data[offset] = r - excess;
        out.data[offset + 2] = b - excess;
      }
      despilled += 1;
    }
  }
  return { raster: out, key, cleared, softened, despilled };
}

/** Marks pixels within `radius` (Chebyshev) of a pixel that is not fully opaque. */
function nearTransparency(raster: Raster, radius: number): Uint8Array {
  const marks = new Uint8Array(raster.width * raster.height);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      if (alphaAt(raster, x, y) === 255) {
        continue;
      }
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < raster.width && ny < raster.height) {
            marks[ny * raster.width + nx] = 1;
          }
        }
      }
    }
  }
  return marks;
}
