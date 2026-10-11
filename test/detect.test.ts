import { deepStrictEqual, notDeepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';

import {
  contentBounds,
  defaultMatchOptions,
  detectRepeatSpan,
  detectStretchSpan,
} from '../src/detect.js';
import { defaultInspectOptions, inspectRaster, type InspectReport } from '../src/inspect.js';
import { createRaster } from '../src/raster.js';
import { insetsProblem } from '../src/slices.js';
import {
  clear,
  fill,
  fillRect,
  horizontalGradient,
  panel,
  ropePanel,
  setPixel,
  shadedBar,
  type Color,
} from './fixtures.js';

function codes(report: InspectReport): string[] {
  return report.findings.map((finding) => finding.code);
}

/**
 * @evidence docs/spec.md#slice-insets Checks negative, fractional, and span-consuming insets.
 * @evidenceReview docs/spec.md#slice-insets #5f061b0 Checked the assertions against the section and ran this test green with pnpm test.
 */
export function rejectsInsetsWithoutAStretchSpan(): void {
  strictEqual(insetsProblem({ left: 4, right: 4, top: 4, bottom: 4 }, 9, 9), undefined);
  ok(insetsProblem({ left: 5, right: 4, top: 0, bottom: 0 }, 9, 9)?.includes('left + right'));
  ok(insetsProblem({ left: 0, right: 0, top: 5, bottom: 4 }, 9, 9)?.includes('top + bottom'));
  ok(insetsProblem({ left: -1, right: 0, top: 0, bottom: 0 }, 9, 9)?.includes('non-negative'));
  ok(insetsProblem({ left: 1.5, right: 0, top: 0, bottom: 0 }, 9, 9)?.includes('integer'));

  // Fixed parts taking most of a resizable axis are worth a warning.
  const crowded = inspectRaster(panel(40, 30), {
    ...defaultInspectOptions,
    insets: { left: 12, right: 12, top: 6, bottom: 6 },
  });
  const large = crowded.findings.find((finding) => finding.code === 'insets.large');
  deepStrictEqual(large?.details, { axis: 'x', fixed: 24, length: 40 });
  strictEqual(codes(inspectRaster(panel(40, 30))).includes('insets.large'), false);
}

/**
 * @evidence docs/spec.md#stretch-detection Detects the 6 px border of a panel, prefers the center run, and falls back with a warning.
 * @evidenceReview docs/spec.md#stretch-detection #ff483ae Checked the assertions against the section and ran this test green with pnpm test.
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

  // Exact matching: every column of the gradient differs from its neighbor.
  const gradient = inspectRaster(horizontalGradient(30, 10), {
    ...defaultInspectOptions,
    mode: 'nine',
    noise: 'off',
  });
  ok(codes(gradient).includes('stretch.x.none'));
  strictEqual(gradient.scale9Borders.w, 1);
  // With noise handling, a gentle gradient counts as stretchable shading.
  const shading = inspectRaster(horizontalGradient(30, 10));
  strictEqual(codes(shading).includes('stretch.x.none'), false);

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
 * @evidence docs/spec.md#three-slice Turns a bar whose rows never repeat into a three-slice and honours forced three-slice mode.
 * @evidenceReview docs/spec.md#three-slice #08c1617 Checked the assertions against the section and ran this test green with pnpm test.
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
 * @evidenceReview docs/spec.md#stretch-uniformity #695468c Checked the assertions against the section and ran this test green with pnpm test.
 */
export function rejectsGivenInsetsThatStretchDetail(): void {
  const report = inspectRaster(panel(40, 30), {
    ...defaultInspectOptions,
    insets: { left: 2, right: 6, top: 6, bottom: 6 },
  });
  strictEqual(report.ok, false);
  const finding = report.findings.find((item) => item.code === 'stretch.x.nonuniform');
  deepStrictEqual(finding?.details, { axis: 'x', pair: [2, 3] });

  // Insets that leave no span are a finding, not an exception.
  const invalid = inspectRaster(panel(40, 30), {
    ...defaultInspectOptions,
    insets: { left: 30, right: 30, top: 6, bottom: 6 },
  });
  strictEqual(invalid.ok, false);
  ok(codes(invalid).includes('insets.invalid'));

  const fine = inspectRaster(panel(40, 30), {
    ...defaultInspectOptions,
    insets: { left: 8, right: 8, top: 7, bottom: 9 },
  });
  strictEqual(fine.ok, true);
  strictEqual(fine.insetsSource, 'given');
}

/**
 * @evidence docs/spec.md#transparent-margins Warns about margins, keeps them in the insets, and rejects an empty image.
 * @evidenceReview docs/spec.md#transparent-margins #5bcc022 Checked the assertions against the section and ran this test green with pnpm test.
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
 * @evidenceReview docs/spec.md#chroma-spill #420e523 Checked the assertions against the section and ran this test green with pnpm test.
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
 * @evidenceReview docs/spec.md#tiling-seams #e6197a2 Checked the assertions against the section and ran this test green with pnpm test.
 */
export function checksTilingSeams(): void {
  const striped = createRaster(24, 8);
  for (let x = 0; x < 24; x += 1) {
    fillRect(striped, x, 0, 1, 8, x % 4 < 2 ? [200, 0, 0, 255] : [0, 0, 200, 255]);
  }
  const tiled = { ...defaultInspectOptions, mode: 'three' as const, tile: { x: true, y: false },
    // Exact synthetic stripes: measured noise would be the stripes themselves.
    noise: 'off' as const };
  const seamless = inspectRaster(striped, {
    ...tiled,
    insets: { left: 4, right: 4, top: 0, bottom: 0 },
  });
  strictEqual(seamless.ok, true);
  // Stripes have no frame, so only content-padding notes may appear.
  deepStrictEqual(
    codes(seamless).filter((code) => !code.startsWith('padding.')),
    [],
  );

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

/**
 * @evidence docs/spec.md#stretch-detection Detects a noisy panel only with the measured noise floor, and leaves clean art exact.
 * @evidenceReview docs/spec.md#stretch-detection #ff483ae Checked the assertions against the section and ran this test green with pnpm test.
 */
export function toleratesGeneratedNoise(): void {
  const noisy = panel(60, 40);
  let seed = 7;
  for (let index = 0; index < noisy.data.length; index += 4) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const jitter = (seed % 7) - 3;
    for (let channel = 0; channel < 3; channel += 1) {
      noisy.data[index + channel] = Math.max(0, Math.min(255, (noisy.data[index + channel] ?? 0) + jitter));
    }
  }
  const auto = inspectRaster(noisy);
  deepStrictEqual(auto.insets, { left: 6, right: 6, top: 6, bottom: 6 });
  const finding = auto.findings.find((item) => item.code === 'noise.tolerance');
  ok(auto.matching.x.tolerance > defaultInspectOptions.tolerance);
  strictEqual(auto.matching.y.outlierRatio, 0.02);
  strictEqual(finding?.severity, 'info');

  const exact = inspectRaster(noisy, { ...defaultInspectOptions, noise: 'off' });
  // Exact matching splits the noisy fill into short, off-center runs.
  notDeepStrictEqual(exact.insets, auto.insets);

  strictEqual(codes(inspectRaster(panel(60, 40))).includes('noise.tolerance'), false);

  // A vertical gradient raises only the vertical tolerance.
  const shaded = panel(60, 40);
  for (let y = 6; y < 34; y += 1) {
    fillRect(shaded, 6, y, 48, 1, [60 + y * 2, 60, 40, 255]);
  }
  const shadedReport = inspectRaster(shaded);
  strictEqual(shadedReport.matching.x.tolerance, defaultInspectOptions.tolerance);
  ok(shadedReport.matching.y.tolerance > defaultInspectOptions.tolerance);
  deepStrictEqual(shadedReport.insets, { left: 6, right: 6, top: 6, bottom: 6 });

  const busy = createRaster(40, 40);
  for (let y = 0; y < 40; y += 1) {
    for (let x = 0; x < 40; x += 1) {
      setPixel(busy, x, y, (x + y) % 2 === 0 ? [220, 220, 220, 255] : [40, 40, 40, 255]);
    }
  }
  const busyReport = inspectRaster(busy);
  ok(codes(busyReport).includes('noise.high'));
  strictEqual(busyReport.matching.x.tolerance, 24);
}

/**
 * @evidence docs/spec.md#repeating-edges Tiles a rope-patterned edge with its period, and warns about a non-repeating edge.
 * @evidenceReview docs/spec.md#repeating-edges #795d113 Checked the assertions against the section and ran this test green with pnpm test.
 */
export function tilesRepeatingEdges(): void {
  const report = inspectRaster(ropePanel(96, 40));
  const finding = report.findings.find((item) => item.code === 'tile.x.auto');
  strictEqual(finding?.details?.['period'], 6);
  strictEqual(report.tile.x, true);
  strictEqual(report.tile.y, false);
  strictEqual((report.scale9Borders.w % 6), 0);
  strictEqual(codes(report).includes('tile.x.seam'), false);

  // Every column of the border differs from every other: nothing repeats.
  const organic = panel(96, 40);
  for (let x = 6; x < 90; x += 1) {
    fillRect(organic, x, 2, 1, 3, [(x * 37) % 256, (x * 91) % 256, 60, 255]);
  }
  // A 4 px pattern on columns 6..19 leaves 2 lines over; the span shifts toward the center.
  const offCenter = createRaster(40, 4);
  for (let x = 0; x < 40; x += 1) {
    const color: Color =
      x >= 6 && x < 20
        ? [x % 4 < 2 ? 220 : 40, 80, 80, 255]
        : [(x * 53) % 256, (x * 29) % 256, 200, 255];
    fillRect(offCenter, x, 0, 1, 4, color);
  }
  deepStrictEqual(
    detectRepeatSpan(offCenter, 'x', { x: 0, y: 0, width: 40, height: 4 }, defaultMatchOptions),
    { span: { start: 8, end: 20 }, period: 4 },
  );

  // A run straddling the center: every window touches it, so the midpoint decides.
  const straddling = createRaster(40, 4);
  for (let x = 0; x < 40; x += 1) {
    const color: Color =
      x >= 14 && x < 24
        ? [x % 4 < 2 ? 220 : 40, 80, 80, 255]
        : [(x * 53) % 256, (x * 29) % 256, 200, 255];
    fillRect(straddling, x, 0, 1, 4, color);
  }
  deepStrictEqual(
    detectRepeatSpan(straddling, 'x', { x: 0, y: 0, width: 40, height: 4 }, defaultMatchOptions),
    { span: { start: 16, end: 24 }, period: 4 },
  );

  const organicReport = inspectRaster(organic, { ...defaultInspectOptions, noise: 'off' });
  ok(
    codes(organicReport).includes('stretch.x.none') || codes(organicReport).includes('stretch.x.short'),
  );
  strictEqual(organicReport.tile.x, false);
}

/**
 * @evidence docs/spec.md#interior-alpha Flags a partly transparent hole in the fill and ignores an empty frame center.
 * @evidenceReview docs/spec.md#interior-alpha #d87616b Checked the assertions against the section and ran this test green with pnpm test.
 */
export function flagsInteriorAlphaHoles(): void {
  const holed = panel(60, 40);
  fillRect(holed, 20, 12, 20, 16, [90, 60, 40, 120]);
  const finding = inspectRaster(holed).findings.find((item) => item.code === 'alpha.interior');
  strictEqual(finding?.severity, 'warning');

  const frame = panel(60, 40);
  fillRect(frame, 6, 6, 48, 28, clear);
  strictEqual(codes(inspectRaster(frame)).includes('alpha.interior'), false);
  strictEqual(codes(inspectRaster(panel(60, 40))).includes('alpha.interior'), false);
}

void test('slice insets need a stretch span', rejectsInsetsWithoutAStretchSpan);
void test('stretch detection finds panel borders', detectsPanelInsets);
void test('three-slice detection', treatsShadedBarsAsThreeSlices);
void test('stretch uniformity of given insets', rejectsGivenInsetsThatStretchDetail);
void test('transparent margins', warnsAboutTransparentMargins);
void test('chroma spill', flagsChromaSpill);
void test('tiling seams', checksTilingSeams);
void test('noise tolerance', toleratesGeneratedNoise);
void test('repeating edges', tilesRepeatingEdges);
void test('interior alpha', flagsInteriorAlphaHoles);
