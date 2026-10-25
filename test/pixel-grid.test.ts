import { ok, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';

import { defaultInspectOptions, inspectRaster } from '../src/inspect.js';
import { defaultNormalizeOptions, normalizeRaster } from '../src/normalize.js';
import { detectPixelGrid, pixelGridFindings, snapToPixelGrid } from '../src/pixel-grid.js';
import { createRaster, pixelOffset, type Raster } from '../src/raster.js';
import { resizeRaster } from '../src/resize.js';

/** Random four-color art, one color per art pixel. */
function art(width: number, height: number, seed = 1): Raster {
  const raster = createRaster(width, height);
  let state = seed;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      state = (state * 1103515245 + 12345) % 2147483648;
      const level = Math.floor((state / 2147483648) * 4) * 70;
      raster.data.set([level, 255 - level, 100, 255], pixelOffset(raster, x, y));
    }
  }
  return raster;
}

function same(a: Raster, b: Raster): boolean {
  return (
    a.width === b.width && a.height === b.height && a.data.every((value, i) => value === b.data[i])
  );
}

/** Averages each 2x2 block of pixels, like anti-aliased edges. */
function soften(raster: Raster): Raster {
  const out = createRaster(raster.width, raster.height);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const nearby = [
        pixelOffset(raster, x, y),
        pixelOffset(raster, Math.min(x + 1, raster.width - 1), y),
        pixelOffset(raster, x, Math.min(y + 1, raster.height - 1)),
        pixelOffset(raster, Math.min(x + 1, raster.width - 1), Math.min(y + 1, raster.height - 1)),
      ];
      for (let channel = 0; channel < 4; channel += 1) {
        const sum = nearby.reduce((total, at) => total + (raster.data[at + channel] ?? 0), 0);
        out.data[pixelOffset(out, x, y) + channel] = Math.round(sum / 4);
      }
    }
  }
  return out;
}

/**
 * @evidence docs/spec.md#pixel-grid Detects whole and fractional upscales, snaps them back exactly, flags blurred art as off the grid, reports only when inspection asks, and snaps before a nearest resize in normalization.
 * @evidenceReview docs/spec.md#pixel-grid #70f3d39 Checked this test against the section line by line and ran it green with pnpm test.
 */
export function detectsPixelGrid(): void {
  const source = art(16, 12);
  for (const factor of [2, 3, 4, 3.5, 5.25]) {
    const upscaled = resizeRaster(
      source,
      Math.round(16 * factor),
      Math.round(12 * factor),
      'nearest',
    );
    const grid = detectPixelGrid(upscaled);
    ok(Math.abs(grid.x.scale - factor) < 0.05, `x scale ${grid.x.scale} for ${factor}`);
    ok(Math.abs(grid.y.scale - factor) < 0.05, `y scale ${grid.y.scale} for ${factor}`);
    strictEqual(grid.offGrid, 0, `${factor} ${JSON.stringify(grid)}`);
    ok(same(snapToPixelGrid(upscaled, grid), source), `snap restores ${factor}x`);
    const codes = pixelGridFindings(grid).map((finding) => finding.code);
    strictEqual(codes.join(), 'pixel.upscaled');
  }

  // Sparse art, few boundaries: a whole 6x upscale must not read as ~6.3x.
  const framed = createRaster(24, 16);
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 24; x += 1) {
      const corner = (x === 0 || x === 23) && (y === 0 || y === 15);
      const inner = x >= 2 && x <= 21 && y >= 2 && y <= 13;
      const dot = (x === 2 || x === 21) && (y === 2 || y === 13);
      if (!corner) {
        const color = dot ? [255, 255, 255, 255] : inner ? [90, 160, 90, 255] : [20, 20, 40, 255];
        framed.data.set(color, pixelOffset(framed, x, y));
      }
    }
  }
  const sixfold = detectPixelGrid(resizeRaster(framed, 144, 96, 'nearest'));
  strictEqual(sixfold.x.scale, 6);
  strictEqual(sixfold.y.scale, 6);
  strictEqual(`${sixfold.native.width}x${sixfold.native.height}`, '24x16');

  const native = detectPixelGrid(source);
  strictEqual(native.x.scale, 1);
  strictEqual(pixelGridFindings(native)[0]?.code, 'pixel.no-grid');

  const blurred = soften(resizeRaster(source, 64, 48, 'nearest'));
  const soft = detectPixelGrid(blurred);
  ok(soft.x.scale > 2, `blurred scale ${soft.x.scale}`);
  ok(
    pixelGridFindings(soft).some((finding) => finding.code === 'pixel.off-grid'),
    `off-grid ${soft.offGrid}`,
  );

  const big = resizeRaster(source, 56, 42, 'nearest');
  const inspected = inspectRaster(big, { ...defaultInspectOptions, pixelArt: true });
  ok(inspected.findings.some((finding) => finding.code === 'pixel.upscaled'));
  ok(!inspectRaster(big).findings.some((finding) => finding.code.startsWith('pixel.')));

  const normalized = normalizeRaster(big, { ...defaultNormalizeOptions, pixelArt: true, scale: 2 });
  strictEqual(normalized.steps.map((step) => step.step).join(), 'snap,resize');
  ok(same(normalized.raster, resizeRaster(source, 32, 24, 'nearest')));
  strictEqual(
    normalized.report.findings.filter((finding) => finding.code.startsWith('pixel.')).length,
    1,
  );
}

void test('pixel grid', detectsPixelGrid);
