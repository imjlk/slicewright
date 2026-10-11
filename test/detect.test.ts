import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';

import { contentBounds, defaultMatchOptions, detectStretchSpan } from '../src/detect.js';
import { defaultInspectOptions, inspectRaster, type InspectReport } from '../src/inspect.js';
import { createRaster } from '../src/raster.js';
import { insetsProblem } from '../src/slices.js';
import {
  clear,
  fill,
  fillRect,
  horizontalGradient,
  panel,
  setPixel,
  shadedBar,
} from './fixtures.js';

function codes(report: InspectReport): string[] {
  return report.findings.map((finding) => finding.code);
}

/**
 * @evidence docs/spec.md#slice-insets Checks negative, fractional, and span-consuming insets.
 * @evidenceReview docs/spec.md#slice-insets Read the section and ran this test green with pnpm test.
 */
export function rejectsInsetsWithoutAStretchSpan(): void {
  strictEqual(insetsProblem({ left: 4, right: 4, top: 4, bottom: 4 }, 9, 9), undefined);
  ok(insetsProblem({ left: 5, right: 4, top: 0, bottom: 0 }, 9, 9)?.includes('left + right'));
  ok(insetsProblem({ left: 0, right: 0, top: 5, bottom: 4 }, 9, 9)?.includes('top + bottom'));
  ok(insetsProblem({ left: -1, right: 0, top: 0, bottom: 0 }, 9, 9)?.includes('non-negative'));
  ok(insetsProblem({ left: 1.5, right: 0, top: 0, bottom: 0 }, 9, 9)?.includes('integer'));
}

/**
 * @evidence docs/spec.md#stretch-detection Detects the 6 px border of a panel, prefers the center run, and falls back with a warning.
 * @evidenceReview docs/spec.md#stretch-detection Read the section and ran this test green with pnpm test.
 */
export function detectsPanelInsets(): void {
  const report = inspectRaster(panel(40, 30));
  deepStrictEqual(report.insets, { left: 6, right: 6, top: 6, bottom: 6 });
  strictEqual(report.mode, 'nine');
  strictEqual(report.ok, true);
  deepStrictEqual(report.scale9Borders, { x: 6, y: 6, w: 28, h: 18 });
  deepStrictEqual(report.minSize, { width: 12, height: 12 });

  const twoRuns = createRaster(9, 1);
  fillRect(twoRuns, 0, 0, 9, 1, fill);
  setPixel(twoRuns, 2, 0, [255, 0, 0, 255]);
  setPixel(twoRuns, 6, 0, [255, 0, 0, 255]);
  // Runs 0..1, 3..5, and 7..8: the three-column run covering the center wins.
  deepStrictEqual(
    detectStretchSpan(twoRuns, 'x', { x: 0, y: 0, width: 9, height: 1 }, defaultMatchOptions),
    { start: 3, end: 6 },
  );

  const gradient = inspectRaster(horizontalGradient(30, 10));
  ok(codes(gradient).includes('stretch.x.none'));
  strictEqual(gradient.scale9Borders.w, 1);

  const noisy = panel(40, 30);
  setPixel(noisy, 20, 15, [100, 60, 40, 255]);
  // The noise pixel splits each span; the longer half before it wins.
  deepStrictEqual(inspectRaster(noisy).insets, { left: 6, right: 20, top: 6, bottom: 15 });
  deepStrictEqual(inspectRaster(noisy, { ...defaultInspectOptions, tolerance: 12 }).insets, {
    left: 6,
    right: 6,
    top: 6,
    bottom: 6,
  });
}

/**
 * @evidence docs/spec.md#three-slice Turns a vertically shaded bar into a three-slice and honours forced three-slice mode.
 * @evidenceReview docs/spec.md#three-slice Read the section and ran this test green with pnpm test.
 */
export function treatsShadedBarsAsThreeSlices(): void {
  const bar = inspectRaster(shadedBar(48, 12));
  strictEqual(bar.mode, 'three');
  deepStrictEqual(bar.insets, { left: 5, right: 5, top: 0, bottom: 0 });
  deepStrictEqual(bar.scale9Borders, { x: 5, y: 0, w: 38, h: 12 });
  deepStrictEqual(bar.minSize, { width: 10, height: 12 });
  ok(codes(bar).includes('three-slice.auto'));

  const forced = inspectRaster(panel(40, 30), { ...defaultInspectOptions, mode: 'three' });
  strictEqual(forced.mode, 'three');
  strictEqual(forced.insets.top + forced.insets.bottom, 0);
  strictEqual(codes(forced).includes('three-slice.auto'), false);
}

/**
 * @evidence docs/spec.md#stretch-uniformity Reports the first mismatching pair for caller insets that cut into the border.
 * @evidenceReview docs/spec.md#stretch-uniformity Read the section and ran this test green with pnpm test.
 */
export function rejectsGivenInsetsThatStretchDetail(): void {
  const report = inspectRaster(panel(40, 30), {
    ...defaultInspectOptions,
    insets: { left: 2, right: 6, top: 6, bottom: 6 },
  });
  strictEqual(report.ok, false);
  const finding = report.findings.find((item) => item.code === 'stretch.x.nonuniform');
  deepStrictEqual(finding?.details, { axis: 'x', pair: [2, 3] });

  const fine = inspectRaster(panel(40, 30), {
    ...defaultInspectOptions,
    insets: { left: 8, right: 8, top: 7, bottom: 9 },
  });
  strictEqual(fine.ok, true);
  strictEqual(fine.insetsSource, 'given');
}

/**
 * @evidence docs/spec.md#transparent-margins Warns about margins, keeps them in the insets, and rejects an empty image.
 * @evidenceReview docs/spec.md#transparent-margins Read the section and ran this test green with pnpm test.
 */
export function warnsAboutTransparentMargins(): void {
  const report = inspectRaster(panel(40, 30, 3));
  ok(codes(report).includes('margin.transparent'));
  deepStrictEqual(report.contentBounds, { x: 3, y: 3, width: 40, height: 30 });
  deepStrictEqual(report.insets, { left: 9, right: 9, top: 9, bottom: 9 });

  const empty = inspectRaster(createRaster(8, 8));
  strictEqual(empty.ok, false);
  ok(codes(empty).includes('image.empty'));
  strictEqual(contentBounds(createRaster(3, 3)), undefined);
}

/**
 * @evidence docs/spec.md#chroma-spill Flags green-tinted alpha edges and ignores a clean outline.
 * @evidenceReview docs/spec.md#chroma-spill Read the section and ran this test green with pnpm test.
 */
export function flagsChromaSpill(): void {
  const clean = panel(40, 30, 2);
  strictEqual(codes(inspectRaster(clean)).includes('alpha.chroma-spill'), false);

  const spilled = panel(40, 30, 2);
  for (let x = 2; x < 42; x += 1) {
    setPixel(spilled, x, 2, [30, 200, 40, 160]);
  }
  setPixel(spilled, 0, 0, clear);
  const finding = inspectRaster(spilled).findings.find(
    (item) => item.code === 'alpha.chroma-spill',
  );
  strictEqual(finding?.severity, 'warning');
  ok(finding?.message.includes('green'));
}

/**
 * @evidence docs/spec.md#tiling-seams Accepts a whole-period tile span and warns when the span breaks the period.
 * @evidenceReview docs/spec.md#tiling-seams Read the section and ran this test green with pnpm test.
 */
export function checksTilingSeams(): void {
  const striped = createRaster(24, 8);
  for (let x = 0; x < 24; x += 1) {
    fillRect(striped, x, 0, 1, 8, x % 4 < 2 ? [200, 0, 0, 255] : [0, 0, 200, 255]);
  }
  const tiled = { ...defaultInspectOptions, mode: 'three' as const, tile: { x: true, y: false } };
  const seamless = inspectRaster(striped, {
    ...tiled,
    insets: { left: 4, right: 4, top: 0, bottom: 0 },
  });
  strictEqual(seamless.ok, true);
  deepStrictEqual(codes(seamless), []);

  const seam = inspectRaster(striped, {
    ...tiled,
    insets: { left: 4, right: 5, top: 0, bottom: 0 },
  });
  const finding = seam.findings.find((item) => item.code === 'tile.x.seam');
  strictEqual(finding?.details?.['period'], 4);
  deepStrictEqual(finding?.details?.['nearestLengths'], [12, 16]);
  strictEqual(codes(seam).includes('stretch.x.nonuniform'), false);

  const ramp = horizontalGradient(20, 4);
  const rampTiled = inspectRaster(ramp, {
    ...tiled,
    insets: { left: 2, right: 2, top: 0, bottom: 0 },
  });
  ok(codes(rampTiled).includes('tile.x.seam'));
}

void test('slice insets need a stretch span', rejectsInsetsWithoutAStretchSpan);
void test('stretch detection finds panel borders', detectsPanelInsets);
void test('three-slice detection', treatsShadedBarsAsThreeSlices);
void test('stretch uniformity of given insets', rejectsGivenInsetsThatStretchDetail);
void test('transparent margins', warnsAboutTransparentMargins);
void test('chroma spill', flagsChromaSpill);
void test('tiling seams', checksTilingSeams);
