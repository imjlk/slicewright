import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { test } from 'node:test';

import {
  checkSnapshot,
  type BrowserCheckOptions,
  type BrowserPixelRegion,
  type BrowserSnapshot,
} from '../src/browser.js';
import { createRaster } from '../src/raster.js';

function snapshot(): BrowserSnapshot {
  const clip = { x: 40, y: 90, width: 20, height: 20 };
  const raster = createRaster(20, 20);
  for (let at = 0; at < raster.data.length; at += 4) {
    raster.data.set([80, 90, 100, 255], at);
  }
  return { clip, raster, measurement: { bounds: clip } };
}

/**
 * @evidenceReview docs/spec.md#browser-regional-pixel-policies #17cfb4a Reviewed independent mean, p99 and peak budgets, multiple regions, local-coordinate rounding, alpha and outside failures, invalid input and full-image change behavior; ran this group in the passing 52-test suite.
 * @evidence docs/spec.md#browser-regional-pixel-policies Tests local rectangle sampling, strict outside/alpha guards, all three independent budgets, fractional rounding, malformed policies and separate change assertions.
 */
export function checksRegionalPixelPolicies(): void {
  const reference = snapshot();
  const actual = snapshot();
  actual.raster.data[0] = 84;
  const region: BrowserPixelRegion = {
    name: 'label',
    bounds: [{ x: 0, y: 0, width: 10, height: 20 }],
    pixels: { mean: 0.02, p99: 0, max: 4 },
  };
  const options = { reference, pixelRegions: [region] };
  strictEqual(checkSnapshot(actual, { reference }).ok, false);
  const result = checkSnapshot(actual, options);
  strictEqual(result.ok, true);
  deepStrictEqual(result.pixelPolicy?.regions[0]?.difference, { mean: 0.02, p99: 0, max: 4 });
  strictEqual(result.pixelPolicy?.regions[0]?.samples, 200);
  strictEqual(result.pixelPolicy?.outside.samples, 200);
  for (const pixels of [
    { mean: 0.019, p99: 255, max: 255 },
    { mean: 255, p99: 255, max: 3 },
  ]) {
    strictEqual(
      checkSnapshot(actual, { reference, pixelRegions: [{ ...region, pixels }] }).ok,
      false,
    );
  }
  const many = structuredClone(actual);
  many.raster.data[4] = 84;
  many.raster.data[8] = 84;
  strictEqual(
    checkSnapshot(many, { reference, pixelRegions: [{ ...region, pixels: { mean: 255, p99: 0, max: 255 } }] }).ok,
    false,
  );
  const outside = structuredClone(actual);
  outside.raster.data[(20 * 20 - 1) * 4] = 81;
  ok(
    checkSnapshot(outside, options).findings.some(
      (finding) => finding.code === 'browser.pixels-outside',
    ),
  );
  const alpha = structuredClone(reference);
  alpha.raster.data[3] = 254;
  const alphaResult = checkSnapshot(alpha, {
    reference,
    pixelRegions: [{ ...region, pixels: { mean: 255, p99: 255, max: 255 } }],
  });
  strictEqual(alphaResult.ok, false);
  strictEqual(alphaResult.pixelPolicy?.regions[0]?.alphaChanges, 1);
  strictEqual(checkSnapshot(actual, { ...options, changedFrom: reference }).ok, true);
  ok(
    checkSnapshot(actual, { ...options, changedFrom: actual }).findings.some(
      (finding) => finding.code === 'browser.pixels-unchanged',
    ),
  );
  const fractional = {
    ...region,
    bounds: [{ x: 0.25, y: 0.5, width: 1.5, height: 1.25 }],
    pixels: { mean: 1, p99: 4, max: 4 },
  };
  const rounded = checkSnapshot(actual, { reference, pixelRegions: [fractional] });
  strictEqual(rounded.ok, true);
  deepStrictEqual(rounded.pixelPolicy?.regions[0]?.pixelBounds, [
    { x: 0, y: 0, width: 2, height: 2 },
  ]);
  strictEqual(rounded.pixelPolicy?.regions[0]?.samples, 4);
  const separated = {
    ...region,
    bounds: [
      { x: 0, y: 0, width: 2, height: 1 },
      { x: 0, y: 2, width: 2, height: 1 },
    ],
    pixels: { mean: 1, p99: 4, max: 4 },
  };
  const second = {
    name: 'icon',
    bounds: [{ x: 10, y: 0, width: 2, height: 1 }],
    pixels: { mean: 0, p99: 0, max: 0 },
  };
  const multiple = checkSnapshot(actual, { reference, pixelRegions: [separated, second] });
  strictEqual(multiple.ok, true);
  deepStrictEqual(
    multiple.pixelPolicy?.regions.map((item) => [item.name, item.samples]),
    [
      ['label', 4],
      ['icon', 2],
    ],
  );
  const iconChange = structuredClone(actual);
  iconChange.raster.data[40] = 81;
  const isolated = checkSnapshot(iconChange, { reference, pixelRegions: [separated, second] });
  deepStrictEqual(
    isolated.pixelPolicy?.regions.map((item) => item.ok),
    [true, false],
  );
  throws(() =>
    checkSnapshot(actual, { reference, pixelRegions: [region, { ...region, name: 'overlap' }] }),
  );
  const full = {
    ...region,
    bounds: [{ x: 0, y: 0, width: 20, height: 20 }],
    pixels: { mean: 255, p99: 255, max: 255 },
  };
  strictEqual(
    checkSnapshot(actual, { reference, pixelRegions: [full] }).pixelPolicy?.outside.samples,
    0,
  );
  for (const pixelRegions of [
    [],
    [{ ...region, name: ' ' }],
    [region, region],
    [{ ...region, bounds: [] }],
    [{ ...region, bounds: [{ x: -1, y: 0, width: 1, height: 1 }] }],
    [{ ...region, bounds: [{ x: 19.5, y: 0, width: 1, height: 1 }] }],
    [{ ...region, bounds: [{ x: 0, y: 0, width: 0, height: 1 }] }],
    [{ ...region, bounds: [{ x: 1, y: 1, width: Number.MIN_VALUE, height: 1 }] }],
    [{ ...region, bounds: [{ x: Infinity, y: 0, width: 1, height: 1 }] }],
    [
      {
        ...region,
        bounds: [
          { x: 0.2, y: 0, width: 1, height: 1 },
          { x: 1.3, y: 0, width: 1, height: 1 },
        ],
      },
    ],
    [{ ...region, pixels: { mean: -1, p99: 0, max: 0 } }],
    [{ ...region, pixels: { mean: 0, p99: NaN, max: 0 } }],
    [{ ...region, pixels: { mean: 0, p99: 0, max: 256 } }],
  ]) {
    throws(() => checkSnapshot(actual, { reference, pixelRegions }));
  }
  throws(() => checkSnapshot(actual, { pixelRegions: [region] }));
  throws(() => checkSnapshot(actual, { ...options, pixels: { mean: 0, p99: 0, max: 0 } }));
  throws(() =>
    checkSnapshot(actual, { ...options, pixelRegions: 'label' } as unknown as BrowserCheckOptions),
  );
  const resized = {
    ...reference,
    raster: createRaster(21, 20),
    clip: { ...reference.clip, width: 21 },
  };
  const mismatch = checkSnapshot(actual, { ...options, reference: resized });
  strictEqual(mismatch.ok, false);
  strictEqual(mismatch.pixelPolicy, undefined);
  // Premultiplied transparent RGB remains invisible, including outside regions.
  const invisible = snapshot();
  const hiddenReference = snapshot();
  invisible.raster.data[1599] = 0;
  hiddenReference.raster.data[1599] = 0;
  invisible.raster.data[1596] = 200;
  strictEqual(checkSnapshot(invisible, { ...options, reference: hiddenReference }).ok, true);
}

void test('browser regional pixel policies', checksRegionalPixelPolicies);
