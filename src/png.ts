import { convertIndexedToRgb, decode, encode, hasPngSignature, type DecodedPng } from 'fast-png';

import { createRaster, type Raster } from './raster.js';

const acTL = [0x61, 0x63, 0x54, 0x4c];

/**
 * Decodes a PNG into straight-alpha RGBA8.
 *
 * @evidence docs/spec.md#png-input Converts every supported PNG layout to RGBA8 and refuses the rest by name.
 * @evidenceReview docs/spec.md#png-input Read the section against this function and ran convertsPngLayoutsToRgba green with pnpm test.
 */
export function decodePng(bytes: Uint8Array): Raster {
  if (!hasPngSignature(bytes)) {
    throw new Error('Not a PNG file: the signature does not match.');
  }
  if (hasChunk(bytes, acTL)) {
    throw new Error('Animated PNG is not supported: slice art must be a single frame.');
  }
  const png = decode(bytes);
  if (png.palette !== undefined) {
    return expandChannels(png, convertIndexedToRgb(png), png.palette[0]?.length ?? 3, 8);
  }
  if (png.depth !== 8 && png.depth !== 16) {
    throw new Error(`Grayscale PNG at ${png.depth} bits is not supported; export at 8 bits.`);
  }
  return expandChannels(png, png.data, png.channels, png.depth);
}

export function encodePng(raster: Raster): Uint8Array {
  return encode({
    width: raster.width,
    height: raster.height,
    data: raster.data,
    depth: 8,
    channels: 4,
  });
}

function expandChannels(
  png: DecodedPng,
  data: ArrayLike<number>,
  channels: number,
  depth: 8 | 16,
): Raster {
  const raster = createRaster(png.width, png.height);
  const shift = depth === 16 ? 8 : 0;
  const pixels = png.width * png.height;
  for (let index = 0; index < pixels; index += 1) {
    const source = index * channels;
    const target = index * 4;
    const read = (offset: number): number => ((data[source + offset] ?? 0) >> shift) & 0xff;
    if (channels === 1 || channels === 2) {
      const gray = read(0);
      raster.data[target] = gray;
      raster.data[target + 1] = gray;
      raster.data[target + 2] = gray;
      raster.data[target + 3] = channels === 2 ? read(1) : 255;
    } else if (channels === 3 || channels === 4) {
      raster.data[target] = read(0);
      raster.data[target + 1] = read(1);
      raster.data[target + 2] = read(2);
      raster.data[target + 3] = channels === 4 ? read(3) : 255;
    } else {
      throw new Error(`PNG with ${channels} channels is not supported.`);
    }
  }
  return raster;
}

function hasChunk(bytes: Uint8Array, type: readonly number[]): boolean {
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length =
      ((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0);
    if (type.every((value, index) => bytes[offset + 4 + index] === value)) {
      return true;
    }
    offset += 12 + (length >>> 0);
  }
  return false;
}
