import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { test } from 'node:test';

import { defaultInspectOptions, inspectRaster } from '../src/inspect.js';
import {
  axisFromSpans,
  layoutFromInsets,
  layoutInsets,
  layoutShape,
  minimumLayoutSize,
} from '../src/layout.js';
import { pixelOffset } from '../src/raster.js';
import { inspectAtlas } from '../src/phaser.js';
import { renderLayout, renderPreviewSheet } from '../src/render.js';
import { capabilityFindings, exportForTarget, sliceTargets } from '../src/targets/index.js';
import { crestPanel, fillRect, panel, sameRaster, shadedBar, transpose } from './fixtures.js';

function codes(findings: ReadonlyArray<{ code: string }>): string[] {
  return findings.map((finding) => finding.code);
}

function text(contents: string | Uint8Array | undefined): string {
  return typeof contents === 'string' ? contents : '';
}

/**
 * @evidence docs/spec.md#slice-layouts Builds axes from spans, converts insets both ways, names shapes, sums minimum sizes, and renders proportional segments.
 * @evidenceReview docs/spec.md#slice-layouts #b1ab6bb Checked the assertions against the section and ran this test green with pnpm test.
 */
export function describesSliceLayouts(): void {
  const axis = axisFromSpans(20, [
    { start: 4, end: 8, kind: 'stretch' },
    { start: 12, end: 16, kind: 'tile' },
  ]);
  deepStrictEqual(
    axis.segments.map((segment) => [segment.start, segment.end, segment.kind]),
    [
      [0, 4, 'fixed'],
      [4, 8, 'stretch'],
      [8, 12, 'fixed'],
      [12, 16, 'tile'],
      [16, 20, 'fixed'],
    ],
  );

  const insets = { left: 6, right: 6, top: 5, bottom: 7 };
  const nine = layoutFromInsets(insets, 40, 30);
  strictEqual(layoutShape(nine), 'nine');
  deepStrictEqual(layoutInsets(nine), insets);
  deepStrictEqual(minimumLayoutSize(nine), { width: 12, height: 12 });

  const three = layoutFromInsets({ ...insets, top: 0, bottom: 0 }, 40, 30, { shape: 'three' });
  strictEqual(layoutShape(three), 'three');
  deepStrictEqual(layoutInsets(three), { left: 6, right: 6, top: 0, bottom: 0 });
  deepStrictEqual(minimumLayoutSize(three), { width: 12, height: 30 });
  strictEqual(
    layoutShape(layoutFromInsets(insets, 40, 30, { shape: 'three-vertical' })),
    'three-vertical',
  );
  strictEqual(layoutShape({ x: axisFromSpans(40, []), y: axisFromSpans(30, []) }), 'fixed');

  const multi = { x: axis, y: axisFromSpans(30, [{ start: 5, end: 25, kind: 'stretch' }]) };
  strictEqual(layoutShape(multi), 'multi');
  strictEqual(layoutInsets(multi), undefined);

  // Two equal flexible segments share 20 extra columns equally.
  const source = panel(20, 30);
  const wide = renderLayout(source, multi, 40, 30);
  strictEqual(wide.width, 40);
  const offset = (x: number): number[] => Array.from(
    wide.data.subarray(pixelOffset(wide, x, 15), pixelOffset(wide, x, 15) + 4),
  );
  deepStrictEqual(
    offset(0),
    Array.from(source.data.subarray(pixelOffset(source, 0, 15), pixelOffset(source, 0, 15) + 4)),
  );
  deepStrictEqual(
    offset(39),
    Array.from(source.data.subarray(pixelOffset(source, 19, 15), pixelOffset(source, 19, 15) + 4)),
  );
  ok(sameRaster(renderLayout(source, three, 20, 90), renderLayout(source, three, 20, 30)));
}

/**
 * @evidence docs/spec.md#vertical-three-slice Detects a vertical bar as a vertical three-slice, forces the mode, and leaves its width out of the preview.
 * @evidenceReview docs/spec.md#vertical-three-slice #072e9af Checked the assertions against the section and ran this test green with pnpm test.
 */
export function detectsVerticalThreeSlices(): void {
  const bar = transpose(shadedBar(48, 12));
  const report = inspectRaster(bar);
  strictEqual(report.mode, 'three-vertical');
  ok(codes(report.findings).includes('three-slice.vertical.auto'));
  deepStrictEqual(report.insets, { left: 0, right: 0, top: 5, bottom: 5 });
  strictEqual(layoutShape(report.layout), 'three-vertical');
  deepStrictEqual(report.minSize, { width: 12, height: 10 });

  const forced = inspectRaster(panel(40, 30), {
    ...defaultInspectOptions,
    mode: 'three-vertical',
    insets: { left: 6, right: 6, top: 6, bottom: 6 },
  });
  strictEqual(forced.mode, 'three-vertical');
  deepStrictEqual(forced.insets, { left: 0, right: 0, top: 6, bottom: 6 });
  strictEqual(forced.ok, true);

  // Loader URLs resolve from the loader base, not from the atlas file.
  const loaded = exportForTarget('phaser', {
    name: 'track',
    imageRef: 'track.png',
    raster: bar,
    layout: report.layout,
    loaderPaths: { image: 'ui/track.png', directory: 'ui' },
  });
  ok(loaded.usage.includes("this.load.atlas('track', 'ui/track.png', 'ui/track.json');"));

  // The Phaser target's own vertical export passes the atlas check.
  const exported = exportForTarget('phaser', {
    name: 'track',
    imageRef: 'track.png',
    raster: bar,
    layout: report.layout,
  });
  const atlasReport = inspectAtlas(
    JSON.parse(text(exported.files[0]?.contents)) as unknown,
    bar,
    defaultInspectOptions,
  );
  strictEqual(atlasReport.ok, true);
  strictEqual(atlasReport.frames[0]?.inspection?.mode, 'three-vertical');

  const sheet = renderPreviewSheet(bar, report.layout);
  strictEqual(
    sheet.cells.some((cell) => cell.label === 'wide'),
    false,
  );
  ok(sheet.cells.every((cell) => cell.width === 12));
}

/**
 * @evidence docs/spec.md#multiple-stretch-regions Splits the top edge around a crest only when multiple regions are asked for.
 * @evidenceReview docs/spec.md#multiple-stretch-regions #919c83e Checked the assertions against the section and ran this test green with pnpm test.
 */
export function detectsMultipleRegions(): void {
  const art = crestPanel(96, 40);
  const single = inspectRaster(art);
  strictEqual(single.mode, 'nine');

  const report = inspectRaster(art, { ...defaultInspectOptions, regions: 'multi' });
  strictEqual(report.mode, 'multi');
  ok(codes(report.findings).includes('regions.multi'));
  const stretch = report.layout.x.segments.filter((segment) => segment.kind === 'stretch');
  strictEqual(stretch.length, 2);
  ok((stretch[0]?.end ?? 0) <= 43 && (stretch[1]?.start ?? 0) >= 53);
  strictEqual(report.insets.left, stretch[0]?.start);
  strictEqual(layoutShape({ x: report.layout.x, y: report.layout.y }), 'multi');

  // A three-slice bar with a crest keeps its fixed height and splits around the crest.
  const crestBar = shadedBar(96, 12);
  for (let x = 0; x < 10; x += 1) {
    fillRect(crestBar, 43 + x, 0, 1, 12, [240, 120 + x * 12, 60, 255]);
  }
  const bar = inspectRaster(crestBar, { ...defaultInspectOptions, regions: 'multi' });
  strictEqual(bar.mode, 'multi');
  strictEqual(bar.layout.x.segments.filter((segment) => segment.kind === 'stretch').length, 2);
  deepStrictEqual(bar.layout.y.segments, [{ start: 0, end: 12, kind: 'fixed' }]);
  deepStrictEqual(bar.findings.find((finding) => finding.code === 'regions.multi')?.details, {
    x: 2,
    y: 0,
  });

  const plain = inspectRaster(panel(96, 40), { ...defaultInspectOptions, regions: 'multi' });
  strictEqual(plain.mode, 'nine');
}

/**
 * @evidence docs/spec.md#targets Rejects unsupported shapes without files, notes emulation, warns about tiling gaps and fixed layouts, and lists every target.
 * @evidenceReview docs/spec.md#targets #0358c64 Checked the assertions against the section and ran this test green with pnpm test.
 */
export function checksTargetCapabilities(): void {
  deepStrictEqual(Object.keys(sliceTargets).sort(), ['css', 'phaser']);
  const raster = crestPanel(96, 40);
  const multi = inspectRaster(raster, { ...defaultInspectOptions, regions: 'multi' }).layout;
  const input = { name: 'crest', imageRef: 'crest.png', raster, layout: multi };

  const phaser = exportForTarget('phaser', input);
  strictEqual(phaser.files.length, 0);
  ok(codes(phaser.findings).includes('target.unsupported'));
  strictEqual(exportForTarget('css', input).files.length, 0);

  const vertical = layoutFromInsets({ left: 0, right: 0, top: 6, bottom: 6 }, 40, 30, {
    shape: 'three-vertical',
  });
  const emulated = capabilityFindings(sliceTargets['phaser']!, vertical);
  strictEqual(emulated[0]?.code, 'target.emulated');
  strictEqual(capabilityFindings(sliceTargets['css']!, vertical).length, 0);

  const tiledX = layoutFromInsets({ left: 6, right: 6, top: 6, bottom: 6 }, 40, 30, {
    tile: { x: true, y: false },
  });
  strictEqual(capabilityFindings(sliceTargets['phaser']!, tiledX).length, 0);
  ok(codes(capabilityFindings(sliceTargets['css']!, tiledX)).includes('target.tile'));

  const still = { x: axisFromSpans(40, []), y: axisFromSpans(30, []) };
  const fixed = exportForTarget('css', {
    name: 'still',
    imageRef: 'still.png',
    raster,
    layout: still,
  });
  ok(codes(fixed.findings).includes('target.fixed'));
  strictEqual(fixed.files.length, 0);
  strictEqual(sliceTargets['constructor'] === undefined, false);
  throws(() => exportForTarget('constructor', input), /Unknown target/);

  const nine = layoutFromInsets({ left: 6, right: 6, top: 6, bottom: 6 }, 40, 30);
  for (const target of Object.values(sliceTargets)) {
    const experimental = codes(capabilityFindings(target, nine)).includes('target.experimental');
    strictEqual(experimental, target.status === 'experimental', target.id);
  }
  deepStrictEqual(
    Object.values(sliceTargets)
      .filter((target) => target.status === 'verified')
      .map((target) => target.id)
      .sort(),
    ['css', 'phaser'],
  );
}

/**
 * @evidence docs/spec.md#css-border-image Checks the slice with fill, border widths, round for tiled axes, and the fixed height of a three-slice.
 * @evidenceReview docs/spec.md#css-border-image #53bcb3f Checked the assertions against the section and ran this test green with pnpm test.
 */
export function exportsCssBorderImage(): void {
  const raster = panel(40, 30);
  const layout = layoutFromInsets({ left: 6, right: 8, top: 5, bottom: 7 }, 40, 30, {
    tile: { x: true, y: false },
  });
  const css = text(
    exportForTarget('css', { name: '9 panel', imageRef: 'ui/panel.png', raster, layout }).files[0]?.contents,
  );
  ok(css.includes('.sw-9-panel {'));
  ok(css.includes('border-width: 5px 8px 7px 6px;'));
  ok(css.includes('border-image-slice: 5 8 7 6 fill;'));
  ok(css.includes('border-image-repeat: round stretch;'));
  ok(css.includes('border-image-source: url("ui/panel.png");'));
  ok(css.includes('min-width: 14px;'));

  const three = layoutFromInsets({ left: 6, right: 6, top: 0, bottom: 0 }, 40, 30, {
    shape: 'three',
  });
  const threeCss = text(
    exportForTarget('css', { name: 'bar', imageRef: 'bar.png', raster, layout: three }).files[0]?.contents,
  );
  ok(threeCss.includes('height: 30px;'));
  ok(threeCss.includes('border-image-slice: 0 6 0 6 fill;'));
}

void test('slice layouts', describesSliceLayouts);
void test('vertical three-slice', detectsVerticalThreeSlices);
void test('multiple stretch regions', detectsMultipleRegions);
void test('target capabilities', checksTargetCapabilities);
void test('CSS border-image', exportsCssBorderImage);
