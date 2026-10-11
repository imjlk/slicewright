import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';

import { defaultInspectOptions, inspectRaster } from '../src/inspect.js';
import {
  axisFromSpans,
  layoutFromInsets,
  layoutInsets,
  layoutShape,
  minimumLayoutSize,
} from '../src/layout.js';
import { decodePng } from '../src/png.js';
import { alphaAt, pixelOffset } from '../src/raster.js';
import { renderLayout, renderPreviewSheet } from '../src/render.js';
import { godotPath } from '../src/targets/godot.js';
import { capabilityFindings, exportForTarget, sliceTargets } from '../src/targets/index.js';
import { crestPanel, panel, sameRaster, shadedBar, transpose } from './fixtures.js';

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

  const sheet = renderPreviewSheet(bar, report.layout);
  strictEqual(
    sheet.cells.some((cell) => cell.label === 'wide'),
    false,
  );
  ok(sheet.cells.every((cell) => cell.width === 12));
}

/**
 * @evidence docs/spec.md#multiple-stretch-regions Splits the top edge around a crest only when multiple regions are asked for.
 * @evidenceReview docs/spec.md#multiple-stretch-regions #f7d00d8 Checked the assertions against the section and ran this test green with pnpm test.
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

  const plain = inspectRaster(panel(96, 40), { ...defaultInspectOptions, regions: 'multi' });
  strictEqual(plain.mode, 'nine');
}

/**
 * @evidence docs/spec.md#targets Rejects unsupported shapes without files, notes emulation, warns about tiling gaps and fixed layouts, and lists every target.
 * @evidenceReview docs/spec.md#targets #47e058c Checked the assertions against the section and ran this test green with pnpm test.
 */
export function checksTargetCapabilities(): void {
  deepStrictEqual(Object.keys(sliceTargets).sort(), [
    'css',
    'godot',
    'ninepatch',
    'phaser',
    'unity',
  ]);
  const raster = crestPanel(96, 40);
  const multi = inspectRaster(raster, { ...defaultInspectOptions, regions: 'multi' }).layout;
  const input = { name: 'crest', imageRef: 'crest.png', raster, layout: multi };

  const phaser = exportForTarget('phaser', input);
  strictEqual(phaser.files.length, 0);
  ok(codes(phaser.findings).includes('target.unsupported'));
  strictEqual(exportForTarget('ninepatch', input).files.length, 1);

  const vertical = layoutFromInsets({ left: 0, right: 0, top: 6, bottom: 6 }, 40, 30, {
    shape: 'three-vertical',
  });
  const emulated = capabilityFindings(sliceTargets['phaser']!, vertical);
  strictEqual(emulated[0]?.code, 'target.emulated');
  strictEqual(capabilityFindings(sliceTargets['css']!, vertical).length, 0);

  const tiledX = layoutFromInsets({ left: 6, right: 6, top: 6, bottom: 6 }, 40, 30, {
    tile: { x: true, y: false },
  });
  ok(codes(capabilityFindings(sliceTargets['unity']!, tiledX)).includes('target.tile'));
  ok(codes(capabilityFindings(sliceTargets['ninepatch']!, tiledX)).includes('target.tile'));
  strictEqual(capabilityFindings(sliceTargets['phaser']!, tiledX).length, 0);

  const still = { x: axisFromSpans(40, []), y: axisFromSpans(30, []) };
  ok(codes(capabilityFindings(sliceTargets['css']!, still)).includes('target.fixed'));

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
 * @evidenceReview docs/spec.md#css-border-image #c509052 Checked the assertions against the section and ran this test green with pnpm test.
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

/**
 * @evidence docs/spec.md#godot-styleboxtexture Checks the resource header, res path, margins, and tile-fit stretch mode.
 * @evidenceReview docs/spec.md#godot-styleboxtexture #c03c96a Checked the assertions against the section and ran this test green with pnpm test.
 */
export function exportsGodotStyleBox(): void {
  const raster = panel(40, 30);
  const layout = layoutFromInsets({ left: 6, right: 8, top: 5, bottom: 7 }, 40, 30, {
    tile: { x: false, y: true },
  });
  const tres = text(
    exportForTarget('godot', { name: 'panel', imageRef: 'ui/panel.png', raster, layout }).files[0]?.contents,
  );
  ok(tres.startsWith('[gd_resource type="StyleBoxTexture" load_steps=2 format=3]'));
  ok(tres.includes('path="res://ui/panel.png"'));
  ok(tres.includes('texture_margin_left = 6.0'));
  ok(tres.includes('texture_margin_bottom = 7.0'));
  ok(tres.includes('axis_stretch_horizontal = 0'));
  ok(tres.includes('axis_stretch_vertical = 2'));
  strictEqual(godotPath('../../art/panel.png'), 'res://panel.png');
  strictEqual(godotPath('./ui/panel.png'), 'res://ui/panel.png');
  strictEqual(godotPath('res://themes/panel.png'), 'res://themes/panel.png');
}

/**
 * @evidence docs/spec.md#unity-sprite-border Checks the left, bottom, right, top order and the Sliced and Tiled image types.
 * @evidenceReview docs/spec.md#unity-sprite-border #3c32535 Checked the assertions against the section and ran this test green with pnpm test.
 */
export function exportsUnitySpriteBorder(): void {
  const raster = panel(40, 30);
  const layout = layoutFromInsets({ left: 6, right: 8, top: 5, bottom: 7 }, 40, 30);
  const result = exportForTarget('unity', { name: 'panel', imageRef: 'panel.png', raster, layout });
  const settings = JSON.parse(text(result.files[0]?.contents)) as {
    spriteBorder: unknown;
    imageType: string;
  };
  deepStrictEqual(settings.spriteBorder, { x: 6, y: 7, z: 8, w: 5 });
  strictEqual(settings.imageType, 'Sliced');
  ok(result.usage.includes('new Vector4(6, 7, 8, 5)'));

  const tiled = layoutFromInsets({ left: 6, right: 8, top: 5, bottom: 7 }, 40, 30, {
    tile: { x: true, y: true },
  });
  const tiledSettings = JSON.parse(
    text(
      exportForTarget('unity', { name: 'panel', imageRef: 'panel.png', raster, layout: tiled }).files[0]?.contents,
    ),
  ) as { imageType: string };
  strictEqual(tiledSettings.imageType, 'Tiled');
}

/**
 * @evidence docs/spec.md#android-nine-patch Decodes the .9.png and checks the frame, the marked columns and rows, multiple regions, and a fixed axis marked whole.
 * @evidenceReview docs/spec.md#android-nine-patch #3191914 Checked the assertions against the section and ran this test green with pnpm test.
 */
export function exportsAndroidNinePatch(): void {
  const raster = crestPanel(96, 40);
  const multi = inspectRaster(raster, { ...defaultInspectOptions, regions: 'multi' }).layout;
  const file = exportForTarget('ninepatch', {
    name: 'crest',
    imageRef: 'crest.png',
    raster,
    layout: multi,
  }).files[0];
  strictEqual(file?.path, 'crest.9.png');
  const patch = decodePng(file?.contents as Uint8Array);
  deepStrictEqual([patch.width, patch.height], [98, 42]);
  const marked = (x: number, y: number): boolean => alphaAt(patch, x, y) === 255;
  strictEqual(marked(0, 0), false);
  const stretch = multi.x.segments.filter((segment) => segment.kind === 'stretch');
  ok(marked((stretch[0]?.start ?? 0) + 1, 0));
  strictEqual(marked(49, 0), false);
  ok(marked((stretch[1]?.start ?? 0) + 1, 0));
  ok(marked(0, 21));
  strictEqual(marked(0, 2), false);
  strictEqual(marked(97, 21), false);

  const three = layoutFromInsets({ left: 6, right: 6, top: 0, bottom: 0 }, 96, 40, {
    shape: 'three',
  });
  const threePatch = decodePng(
    exportForTarget('ninepatch', { name: 'bar', imageRef: 'bar.png', raster, layout: three }).files[0]?.contents as Uint8Array,
  );
  ok(Array.from({ length: 40 }, (_, y) => alphaAt(threePatch, 0, y + 1) === 255).every(Boolean));
}

void test('slice layouts', describesSliceLayouts);
void test('vertical three-slice', detectsVerticalThreeSlices);
void test('multiple stretch regions', detectsMultipleRegions);
void test('target capabilities', checksTargetCapabilities);
void test('CSS border-image', exportsCssBorderImage);
void test('Godot StyleBoxTexture', exportsGodotStyleBox);
void test('Unity sprite border', exportsUnitySpriteBorder);
void test('Android nine-patch', exportsAndroidNinePatch);
