import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
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
 * @evidenceReview docs/spec.md#pixel-grid #cf46969 Reread the section with the sparse-axis, differing-lines, candidate and given-scale rules, checked this test's assertions against it, and ran it green with pnpm test.
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

/** A flat panel: a 2-pixel dark frame around one fill color, `width` by `height` art pixels. */
function flatPanel(width: number, height: number): Raster {
  const raster = createRaster(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inner = x >= 2 && x < width - 2 && y >= 2 && y < height - 2;
      raster.data.set(inner ? [90, 160, 90, 255] : [20, 20, 40, 255], pixelOffset(raster, x, y));
    }
  }
  return raster;
}

/**
 * @evidence docs/spec.md#pixel-grid Reports a flat 6x panel as undetermined with its candidate scales instead of as not pixel art, fills a sparse axis from the other axis's whole scale, and snaps exactly at a given --pixel-scale.
 * @evidenceReview docs/spec.md#pixel-grid #cf46969 Reread the section with the sparse-axis, differing-lines, candidate and given-scale rules, checked this test's assertions against it, and ran it green with pnpm test.
 */
export function judgesSparsePixelGrid(): void {
  const panel = flatPanel(24, 16);
  const sixfold = resizeRaster(panel, 144, 96, 'nearest');

  // Two edges per axis cannot tell a 6x panel from a 12x or native one.
  const sparse = detectPixelGrid(sixfold);
  strictEqual(sparse.x.scale, 1);
  strictEqual(sparse.x.basis, 'sparse');
  strictEqual(sparse.y.basis, 'sparse');
  strictEqual(sparse.candidate, 12);
  const [undetermined, ...rest] = pixelGridFindings(sparse);
  strictEqual(undetermined?.code, 'pixel.grid-undetermined');
  strictEqual(rest.length, 0);
  ok(undetermined.message.includes('12, 6, 4, 3 or 2'), undetermined.message);
  ok(undetermined.message.includes('--pixel-scale'), undetermined.message);
  deepStrictEqual(undetermined.details?.['candidate'], 12);

  // The same panel inspected and normalized with --pixel-art: no snap, no "no grid".
  const inspected = inspectRaster(sixfold, { ...defaultInspectOptions, pixelArt: true });
  const pixelCodes = inspected.findings
    .map((finding) => finding.code)
    .filter((code) => code.startsWith('pixel.'));
  deepStrictEqual(pixelCodes, ['pixel.grid-undetermined']);
  const unsnapped = normalizeRaster(sixfold, { ...defaultNormalizeOptions, pixelArt: true });
  ok(!unsnapped.steps.some((step) => step.step === 'snap'));

  // A known scale places the grid and snaps the panel back exactly.
  const given = detectPixelGrid(sixfold, undefined, { scale: 6 });
  strictEqual(given.x.basis, 'given');
  strictEqual(given.x.fit, 1);
  ok(same(snapToPixelGrid(sixfold, given), panel));
  const givenFinding = pixelGridFindings(given)[0];
  strictEqual(givenFinding?.code, 'pixel.upscaled');
  ok(givenFinding.message.includes('--pixel-scale 6 snaps it to 24x16'), givenFinding.message);
  const snapped = normalizeRaster(sixfold, { ...defaultNormalizeOptions, pixelScale: 6, scale: 2 });
  strictEqual(snapped.steps.map((step) => step.step).join(), 'snap,resize');
  ok(same(snapped.raster, resizeRaster(panel, 48, 32, 'nearest')));
  // The snapped art is not judged again for a grid.
  strictEqual(
    snapped.report.findings.filter((finding) => finding.code.startsWith('pixel.')).length,
    1,
  );
  ok(
    inspectRaster(sixfold, { ...defaultInspectOptions, pixelScale: 6 }).findings.some(
      (finding) => finding.code === 'pixel.upscaled',
    ),
  );
  // Scale 1 says the art is native: nothing to snap.
  strictEqual(
    pixelGridFindings(detectPixelGrid(panel, undefined, { scale: 1 }))[0]?.code,
    'pixel.no-grid',
  );
  throws(() => detectPixelGrid(sixfold, undefined, { scale: 0 }), /--pixel-scale/);
  throws(() => detectPixelGrid(sixfold, undefined, { scale: 200 }), /--pixel-scale/);

  // One flat block has no edge to go by: no candidate.
  const block = createRaster(48, 48);
  block.data.fill(200);
  strictEqual(detectPixelGrid(block).candidate, undefined);
  strictEqual(pixelGridFindings(detectPixelGrid(block))[0]?.code, 'pixel.grid-undetermined');

  // Detail across, flat down: the flat axis takes the scale found across.
  const bar = createRaster(24, 6);
  for (let y = 0; y < 6; y += 1) {
    for (let x = 0; x < 24; x += 1) {
      const frame = y < 2 || y >= 4;
      const level = (x * 7) % 3 === 0 ? 40 : 200;
      raster(bar, x, y, frame ? [20, 20, 40, 255] : [level, 255 - level, 100, 255]);
    }
  }
  const fourfold = detectPixelGrid(resizeRaster(bar, 96, 24, 'nearest'));
  strictEqual(fourfold.x.basis, 'fit');
  strictEqual(fourfold.x.scale, 4);
  strictEqual(fourfold.y.basis, 'spacing');
  strictEqual(fourfold.y.scale, 4);
  deepStrictEqual(fourfold.native, { width: 24, height: 6 });
  ok(pixelGridFindings(fourfold)[0]?.message.includes('few color edges'));

  // Random detail across and flat down is no grid on either axis.
  const noisy = createRaster(97, 24);
  for (let y = 0; y < 24; y += 1) {
    for (let x = 0; x < 97; x += 1) {
      raster(noisy, x, y, y < 8 ? [20, 20, 40, 255] : [(x * 37) % 256, (x * 91) % 256, 100, 255]);
    }
  }
  const native = detectPixelGrid(noisy);
  strictEqual(native.y.basis, 'none');
  strictEqual(pixelGridFindings(native)[0]?.code, 'pixel.no-grid');
}

function raster(target: Raster, x: number, y: number, color: readonly number[]): void {
  target.data.set(color, pixelOffset(target, x, y));
}

void test('sparse pixel grid', judgesSparsePixelGrid);
