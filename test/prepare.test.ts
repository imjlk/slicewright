import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { test } from 'node:test';

import { defaultChromaOptions, detectChromaKey, removeChroma } from '../src/chroma.js';
import { defaultInspectOptions } from '../src/inspect.js';
import { normalizeRaster } from '../src/normalize.js';
import { createRaster, pixelOffset, type Raster } from '../src/raster.js';
import { renderSlices } from '../src/render.js';
import { resizeRaster, targetSize } from '../src/resize.js';
import { fill, fillRect, outline, panel, sameRaster, setPixel, shadedBar } from './fixtures.js';

function pixel(raster: Raster, x: number, y: number): number[] {
  const offset = pixelOffset(raster, x, y);
  return Array.from(raster.data.subarray(offset, offset + 4));
}

/**
 * @evidence docs/spec.md#chroma-removal Keys green and magenta backgrounds, fades the blend band, despills the edge, and refuses an image with no key.
 * @evidenceReview docs/spec.md#chroma-removal #594a7cd Checked the assertions against the section and ran this test green with pnpm test.
 */
export function removesChromaBackgrounds(): void {
  const keyed = createRaster(12, 8);
  fillRect(keyed, 0, 0, 12, 8, [0, 255, 0, 255]);
  fillRect(keyed, 3, 2, 6, 4, outline);
  // A blend of the outline and the key, as anti-aliasing leaves it.
  setPixel(keyed, 2, 3, [40, 130, 20, 255]);
  // Slightly green but far below the keep threshold, next to the edge.
  setPixel(keyed, 3, 2, [60, 80, 40, 255]);

  strictEqual(detectChromaKey(keyed), 'green');
  const result = removeChroma(keyed);
  strictEqual(result.key, 'green');
  deepStrictEqual(pixel(result.raster, 0, 0), [0, 0, 0, 0]);
  deepStrictEqual(pixel(result.raster, 5, 4), [...outline]);
  const blend = pixel(result.raster, 2, 3);
  ok((blend[3] ?? 0) > 0 && (blend[3] ?? 0) < 255);
  ok((blend[1] ?? 0) <= Math.max(blend[0] ?? 0, blend[2] ?? 0));
  deepStrictEqual(pixel(result.raster, 3, 2), [60, 60, 40, 255]);
  ok(result.cleared > 0 && result.softened > 0 && result.despilled > 0);

  const magenta = createRaster(6, 6);
  fillRect(magenta, 0, 0, 6, 6, [255, 0, 255, 255]);
  fillRect(magenta, 2, 2, 2, 2, fill);
  setPixel(magenta, 2, 2, [80, 50, 85, 255]);
  const keyedMagenta = removeChroma(magenta);
  strictEqual(keyedMagenta.key, 'magenta');
  deepStrictEqual(pixel(keyedMagenta.raster, 0, 0), [0, 0, 0, 0]);
  deepStrictEqual(pixel(keyedMagenta.raster, 2, 2), [50, 50, 55, 255]);

  throws(() => removeChroma(panel(20, 16)), /No chroma key/);
  throws(() => removeChroma(keyed, { ...defaultChromaOptions, keep: 90, drop: 80 }), RangeError);
  throws(() => removeChroma(keyed, { ...defaultChromaOptions, despillRadius: 1.5 }), RangeError);
  throws(
    () => removeChroma(keyed, { ...defaultChromaOptions, despillRadius: Infinity }),
    RangeError,
  );
}

/**
 * @evidence docs/spec.md#resizing Averages in premultiplied alpha without colour halos, keeps uniform areas exact, samples nearest pixels, and fits target sizes.
 * @evidenceReview docs/spec.md#resizing #6c29064 Checked the assertions against the section and ran this test green with pnpm test.
 */
export function resizesWithoutHalos(): void {
  const edge = createRaster(2, 1);
  setPixel(edge, 0, 0, [255, 0, 0, 255]);
  setPixel(edge, 1, 0, [0, 255, 0, 0]);
  deepStrictEqual(pixel(resizeRaster(edge, 1, 1), 0, 0), [255, 0, 0, 128]);

  const checker = createRaster(4, 4);
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      setPixel(checker, x, y, (x + y) % 2 === 0 ? [200, 200, 200, 255] : [100, 100, 100, 255]);
    }
  }
  deepStrictEqual(pixel(resizeRaster(checker, 2, 2), 1, 1), [150, 150, 150, 255]);
  deepStrictEqual(pixel(resizeRaster(checker, 2, 2, 'nearest'), 0, 0), [200, 200, 200, 255]);

  const third = resizeRaster(panel(60, 45), 20, 15);
  deepStrictEqual(pixel(third, 10, 7), [...fill]);

  const upscaled = resizeRaster(checker, 8, 8);
  deepStrictEqual(pixel(upscaled, 1, 1), pixel(checker, 0, 0));

  deepStrictEqual(targetSize(400, 200, { width: 100 }), { width: 100, height: 50 });
  deepStrictEqual(targetSize(400, 200, { height: 50 }), { width: 100, height: 50 });
  deepStrictEqual(targetSize(400, 200, { scale: 0.25 }), { width: 100, height: 50 });
  deepStrictEqual(targetSize(400, 200, { width: 90, height: 30 }), { width: 90, height: 30 });
  throws(() => resizeRaster(checker, 0, 4), RangeError);
  for (const request of [
    { scale: 0 },
    { scale: -1 },
    { scale: Number.NaN },
    { width: 1.5 },
    { height: 0 },
    { scale: 2, width: 100 },
  ]) {
    throws(() => targetSize(400, 200, request), RangeError);
  }
}

/**
 * @evidence docs/spec.md#normalization Crops and resizes before inspecting, rebuilds uniform axes losslessly, and leaves a three-slice height alone.
 * @evidenceReview docs/spec.md#normalization #ef22e0f Checked the assertions against the section and ran this test green with pnpm test.
 */
export function normalizesGeneratedArt(): void {
  const target = panel(40, 30);
  const generated = resizeRaster(panel(40, 30, 3), 92, 72, 'nearest');
  // A faint shadow pixel in the margin must not hold the crop open.
  setPixel(generated, 1, 70, [0, 0, 0, 6]);

  const plain = normalizeRaster(generated, {
    inspect: defaultInspectOptions,
    crop: true,
    width: 40,
    filter: 'nearest',
  });
  deepStrictEqual(
    plain.steps.map((step) => step.step),
    ['crop', 'resize'],
  );
  ok(sameRaster(plain.raster, target));
  deepStrictEqual(plain.report.insets, { left: 6, right: 6, top: 6, bottom: 6 });

  const rebuilt = normalizeRaster(generated, {
    inspect: defaultInspectOptions,
    crop: true,
    width: 40,
    filter: 'nearest',
    keep: 2,
  });
  deepStrictEqual([rebuilt.raster.width, rebuilt.raster.height], [14, 14]);
  strictEqual(rebuilt.report.ok, true);
  deepStrictEqual(rebuilt.report.scale9Borders, { x: 6, y: 6, w: 2, h: 2 });
  ok(rebuilt.report.findings.some((item) => item.code === 'rebuild.filtering'));
  deepStrictEqual(rebuilt.steps.at(-1)?.to, { width: 14, height: 14 });
  ok(sameRaster(renderSlices(rebuilt.raster, rebuilt.report.insets, 40, 30), target));

  const bar = normalizeRaster(shadedBar(48, 12), {
    inspect: defaultInspectOptions,
    crop: true,
    filter: 'area',
    keep: 3,
  });
  strictEqual(bar.report.mode, 'three');
  deepStrictEqual([bar.raster.width, bar.raster.height], [13, 12]);

  // A vertical gradient stretches fine but cannot be cut to two rows.
  const shaded = panel(40, 30);
  for (let y = 6; y < 24; y += 1) {
    fillRect(shaded, 6, y, 28, 1, [90 + y * 3, 60, 40, 255]);
  }
  const lossy = normalizeRaster(shaded, {
    inspect: { ...defaultInspectOptions, tolerance: 4 },
    crop: true,
    filter: 'area',
    keep: 2,
  });
  deepStrictEqual([lossy.raster.width, lossy.raster.height], [14, 30]);
  const warning = lossy.report.findings.find((item) => item.code === 'rebuild.y.lossy');
  strictEqual(warning?.severity, 'warning');
  strictEqual(
    lossy.report.findings.some((item) => item.code === 'rebuild.x.lossy'),
    false,
  );

  const broken = normalizeRaster(panel(40, 30), {
    inspect: { ...defaultInspectOptions, insets: { left: 2, right: 2, top: 6, bottom: 6 } },
    crop: true,
    filter: 'area',
    keep: 2,
  });
  strictEqual(broken.report.ok, false);
  strictEqual(broken.raster.width, 40);
  // An invalid keep is refused even when inspection would stop early.
  throws(
    () =>
      normalizeRaster(panel(40, 30), {
        inspect: { ...defaultInspectOptions, insets: { left: 2, right: 2, top: 6, bottom: 6 } },
        crop: true,
        filter: 'area',
        keep: 0,
      }),
    RangeError,
  );
}

void test('chroma removal', removesChromaBackgrounds);
void test('resizing', resizesWithoutHalos);
void test('normalization', normalizesGeneratedArt);
