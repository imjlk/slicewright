import type { PhaserAtlasFrame, PhaserJsonHashAtlas } from './phaser.js';
import { createRaster, pixelOffset, type Raster } from './raster.js';

/** One frame to pack: its pixels and the frame data to keep. */
export interface PackPiece {
  readonly name: string;
  readonly raster: Raster;
  /** Copied into the packed frame; `frame` and the source sizes are replaced. */
  readonly data: Pick<PhaserAtlasFrame, 'scale9Borders' | 'slicewright'>;
}

export interface PackOptions {
  /** Transparent pixels between neighboring frames, extrusion excluded. */
  readonly spacing: number;
  /** Pixels of each frame's edge repeated outward, so filtering never reaches a neighbor. */
  readonly extrude: number;
}

export const defaultPackOptions: PackOptions = { spacing: 2, extrude: 1 };

export interface PackedFrame {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PackResult {
  readonly raster: Raster;
  readonly atlas: PhaserJsonHashAtlas;
  readonly frames: readonly PackedFrame[];
}

/**
 * Packs frames into one image and a JSON Hash atlas. Frames go on shelves,
 * tallest first, in a sheet about as wide as it is tall; each keeps its
 * pixels exactly, untrimmed and unrotated, with its `scale9Borders` and
 * slicewright data, surrounded by `extrude` pixels of its own edge and then
 * `spacing` transparent pixels.
 *
 * @evidence docs/spec.md#atlas-packing Places frames on shelves with extrusion and spacing, copies their pixels exactly, and writes untrimmed, unrotated frames that keep their borders and slicewright data.
 * @evidenceReview docs/spec.md#atlas-packing #76a0a67 Checked this code against the section line by line and ran packsAtlases green with pnpm test.
 */
export function packFrames(
  pieces: readonly PackPiece[],
  image: string,
  options: PackOptions = defaultPackOptions,
): PackResult {
  for (const [name, value] of [
    ['spacing', options.spacing],
    ['extrude', options.extrude],
  ] as const) {
    if (!Number.isInteger(value) || value < 0 || value > 64) {
      throw new RangeError(`The ${name} must be a whole number from 0 to 64, got ${value}.`);
    }
  }
  if (pieces.length === 0) {
    throw new RangeError('Packing needs at least one frame.');
  }
  const names = new Set<string>();
  for (const piece of pieces) {
    if (names.has(piece.name)) {
      throw new RangeError(`Two frames are named "${piece.name}"; frame names must be unique.`);
    }
    names.add(piece.name);
  }

  const { spacing, extrude } = options;
  const cells = pieces.map((piece) => ({
    piece,
    width: piece.raster.width + extrude * 2,
    height: piece.raster.height + extrude * 2,
  }));
  const area = cells.reduce(
    (sum, cell) => sum + (cell.width + spacing) * (cell.height + spacing),
    0,
  );
  const sheetLimit = Math.max(
    Math.max(...cells.map((cell) => cell.width)),
    Math.ceil(Math.sqrt(area)),
  );
  // Tallest first keeps shelves full; names break ties so output is stable.
  const order = [...cells].sort(
    (a, b) => b.height - a.height || b.width - a.width || compareNames(a.piece.name, b.piece.name),
  );
  const placed: Array<{ cell: (typeof cells)[number]; x: number; y: number }> = [];
  let x = 0;
  let y = 0;
  let shelfHeight = 0;
  for (const cell of order) {
    if (x > 0 && x + cell.width > sheetLimit) {
      x = 0;
      y += shelfHeight + spacing;
      shelfHeight = 0;
    }
    placed.push({ cell, x, y });
    x += cell.width + spacing;
    shelfHeight = Math.max(shelfHeight, cell.height);
  }
  const width = Math.max(...placed.map((item) => item.x + item.cell.width));
  const height = Math.max(...placed.map((item) => item.y + item.cell.height));
  const raster = createRaster(width, height);

  const frames: PackedFrame[] = [];
  const atlasFrames: Array<[string, PhaserAtlasFrame]> = [];
  // Atlas frames follow the order the pieces were given, not the shelf order.
  const byName = new Map(placed.map((item) => [item.cell.piece.name, item]));
  for (const piece of pieces) {
    const item = byName.get(piece.name);
    if (item === undefined) {
      continue;
    }
    const left = item.x + extrude;
    const top = item.y + extrude;
    blitExtruded(raster, piece.raster, left, top, extrude);
    const { width: w, height: h } = piece.raster;
    frames.push({ name: piece.name, x: left, y: top, width: w, height: h });
    atlasFrames.push([
      piece.name,
      {
      frame: { x: left, y: top, w, h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w, h },
      sourceSize: { w, h },
      ...(piece.data.scale9Borders === undefined ? {} : { scale9Borders: piece.data.scale9Borders }),
      ...(piece.data.slicewright === undefined ? {} : { slicewright: piece.data.slicewright }),
      },
    ]);
  }
  return {
    raster,
    // fromEntries defines own keys, so a frame named __proto__ stays a frame.
    atlas: { frames: Object.fromEntries(atlasFrames), meta: { image, size: { w: width, h: height }, scale: '1' } },
    frames,
  };
}

/** Copies `source` to (left, top) and repeats its outermost pixels `extrude` times outward. */
function blitExtruded(
  target: Raster,
  source: Raster,
  left: number,
  top: number,
  extrude: number,
): void {
  for (let y = -extrude; y < source.height + extrude; y += 1) {
    const sourceY = Math.min(Math.max(y, 0), source.height - 1);
    for (let x = -extrude; x < source.width + extrude; x += 1) {
      const sourceX = Math.min(Math.max(x, 0), source.width - 1);
      const from = pixelOffset(source, sourceX, sourceY);
      target.data.set(source.data.subarray(from, from + 4), pixelOffset(target, left + x, top + y));
    }
  }
}

function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
