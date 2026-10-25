import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { test } from 'node:test';

import { defaultInspectOptions, inspectRaster } from '../src/inspect.js';
import {
  axisFromSpans,
  layoutFromInsets,
  layoutInsets,
  layoutShape,
  minimumLayoutSize,
  readLayoutJson,
} from '../src/layout.js';
import { defaultNormalizeOptions, normalizeRaster } from '../src/normalize.js';
import { pixelOffset } from '../src/raster.js';
import { inspectAtlas } from '../src/phaser.js';
import { renderLayout, renderPreviewSheet } from '../src/render.js';
import { urlFromPath } from '../src/targets/common.js';
import { cssString } from '../src/targets/css.js';
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
 * @evidenceReview docs/spec.md#slice-layouts #fc52f65 Checked the assertions against the section and ran this test green with pnpm test.
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

  throws(() => axisFromSpans(20, [{ start: 2.5, end: 6.5, kind: 'stretch' }]), RangeError);
  throws(() => axisFromSpans(20.5, []), RangeError);

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
  const sourceThree = layoutFromInsets({ left: 4, right: 4, top: 0, bottom: 0 }, 20, 30, {
    shape: 'three',
  });
  ok(
    sameRaster(renderLayout(source, sourceThree, 20, 90), renderLayout(source, sourceThree, 20, 30)),
  );
  const nineSource = panel(40, 30);
  throws(() => renderLayout(nineSource, nine, Number.POSITIVE_INFINITY, 30), /whole number/);
  throws(() => renderLayout(nineSource, nine, 40, 2.5), /whole number/);
  // A layout built for another image size is refused, not silently misread.
  throws(() => renderLayout(panel(30, 30), nine, 40, 30), /layout is 40x30/);
  throws(
    () =>
      exportForTarget('css', { name: 'p', imageRef: 'p.png', raster: panel(30, 30), layout: nine }),
    RangeError,
  );
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
  ok(loaded.usage.includes('this.load.atlas("track", "ui/track.png", "ui/track.json");'));
  const quoted = exportForTarget('phaser', {
    name: "king's",
    imageRef: "king's.png",
    raster: bar,
    layout: report.layout,
  });
  ok(quoted.usage.includes(`this.load.atlas("king's", "king's.png", "king's.json");`));
  // The fixed-width note is a comment, so the snippet stays valid JavaScript.
  ok(loaded.usage.includes('\n// Keep the width at 12 px.'));
  // A full-height vertical span collides with Phaser's own three-slice encoding.
  const fullHeight = layoutFromInsets({ left: 0, right: 0, top: 0, bottom: 0 }, 12, 48, {
    shape: 'three-vertical',
  });
  const refused = exportForTarget('phaser', {
    name: 'track',
    imageRef: 'track.png',
    raster: bar,
    layout: fullHeight,
  });
  ok(codes(refused.findings).includes('target.unsupported'));
  strictEqual(refused.files.length, 0);
  strictEqual(
    exportForTarget('css', { name: 'track', imageRef: 'track.png', raster: bar, layout: fullHeight }).files.length,
    1,
  );

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
  // Without the marker, full-width borders are an ordinary nine-slice: the
  // track's columns differ, so the column check rejects stretching them.
  const unmarked = JSON.parse(text(exported.files[0]?.contents)) as {
    frames: Record<string, { slicewright?: unknown }>;
  };
  for (const frame of Object.values(unmarked.frames)) {
    delete frame.slicewright;
  }
  // The marker on borders that are not full-width contradicts what Phaser renders.
  const mismatched = JSON.parse(text(exported.files[0]?.contents)) as {
    frames: Record<string, { scale9Borders: { x: number; w: number } }>;
  };
  for (const frame of Object.values(mismatched.frames)) {
    frame.scale9Borders.x = 2;
    frame.scale9Borders.w -= 4;
  }
  const mismatchReport = inspectAtlas(mismatched, bar, defaultInspectOptions);
  ok(
    mismatchReport.frames[0]?.findings.some((finding) => finding.code === 'atlas.marker-mismatch'),
  );
  strictEqual(mismatchReport.ok, false);

  const unmarkedReport = inspectAtlas(unmarked, bar, defaultInspectOptions);
  strictEqual(unmarkedReport.frames[0]?.inspection?.mode, 'nine');
  strictEqual(unmarkedReport.ok, false);

  const sheet = renderPreviewSheet(bar, report.layout);
  strictEqual(
    sheet.cells.some((cell) => cell.label === 'wide'),
    false,
  );
  ok(sheet.cells.every((cell) => cell.width === 12));
}

/**
 * @evidence docs/spec.md#multiple-stretch-regions Splits the top edge around a crest only when multiple regions are asked for.
 * @evidenceReview docs/spec.md#multiple-stretch-regions #d16fdde Checked the assertions against the section and ran this test green with pnpm test.
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

  throws(
    () =>
      inspectRaster(art, {
        ...defaultInspectOptions,
        regions: 'multi',
        insets: { left: 6, right: 6, top: 9, bottom: 6 },
      }),
    RangeError,
  );

  const plain = inspectRaster(panel(96, 40), { ...defaultInspectOptions, regions: 'multi' });
  strictEqual(plain.mode, 'nine');
}

/**
 * @evidence docs/spec.md#targets Rejects unsupported shapes without files, notes emulation, warns about tiling gaps and fixed layouts, and lists every target.
 * @evidenceReview docs/spec.md#targets #2cdaf2d Checked the assertions against the section and ran this test green with pnpm test.
 */
export function checksTargetCapabilities(): void {
  deepStrictEqual(Object.keys(sliceTargets).sort(), ['css', 'defold', 'godot', 'phaser', 'unity']);
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
    raster: panel(40, 30),
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
 * @evidenceReview docs/spec.md#css-border-image #9ee8b1e Checked the assertions against the section and ran this test green with pnpm test.
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
  strictEqual(cssString('a"b\\c.png'), '"a\\"b\\\\c.png"');
  const hostile = text(
    exportForTarget('css', { name: 'x*/ body{}', imageRef: 'ui/button#blue.png', raster, layout }).files[0]
      ?.contents,
  );
  ok(hostile.startsWith('/* slicewright: x* / body{}, nine */'));
  ok(hostile.includes('url("ui/button%23blue.png")'));
  strictEqual(urlFromPath('a b/c?d.png'), 'a%20b/c%3Fd.png');
  strictEqual(urlFromPath('https://cdn.example/x.png'), 'https://cdn.example/x.png');
  ok(css.includes('min-width: 14px;'));
  const linked = exportForTarget('css', {
    name: 'panel',
    imageRef: 'panel.png',
    raster,
    layout,
    loaderPaths: { image: 'ui/panel.png', directory: 'ui' },
  });
  ok(linked.usage.includes('<link rel="stylesheet" href="ui/panel.css">'));
  const hashed = exportForTarget('css', {
    name: 'button#blue',
    imageRef: 'button#blue.png',
    raster,
    layout,
    loaderPaths: { image: 'ui/button#blue.png', directory: 'ui' },
  });
  ok(hashed.usage.includes('href="ui/button%23blue.css"'));

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
/**
 * @evidence docs/spec.md#multiple-stretch-regions Reads back the layout normalization reports for a rebuilt multi-region texture, and rejects one of another size or over detail.
 * @evidenceReview docs/spec.md#multiple-stretch-regions #d16fdde Checked the assertions against the layout-file paragraph and ran this test green with pnpm test.
 */
export function readsBackMultiRegionLayouts(): void {
  const art = crestPanel(240, 100);
  const normalized = normalizeRaster(art, {
    ...defaultNormalizeOptions,
    inspect: { ...defaultInspectOptions, regions: 'multi' },
    keep: 8,
  });
  strictEqual(normalized.report.mode, 'multi');
  const { layout } = normalized.report;
  ok(normalized.raster.width < 240);

  const given = inspectRaster(normalized.raster, { ...defaultInspectOptions, layout });
  ok(given.ok, JSON.stringify(given.findings));
  strictEqual(given.mode, 'multi');
  deepStrictEqual(given.layout.x, layout.x);
  deepStrictEqual(given.layout.y, layout.y);
  // Its content padding is kept as given, not detected again.
  const edge = (axis: 'x' | 'y', last: boolean): number => {
    const segments = layout[axis].segments;
    const segment = last ? segments.at(-1) : segments[0];
    return (segment?.end ?? 0) - (segment?.start ?? 0) - 1;
  };
  const chosen = {
    left: edge('x', false),
    right: edge('x', true),
    top: edge('y', false),
    bottom: edge('y', true),
  };
  ok(JSON.stringify(chosen) !== JSON.stringify(layout.content));
  const padded = inspectRaster(normalized.raster, {
    ...defaultInspectOptions,
    layout: { ...layout, content: chosen },
  });
  deepStrictEqual(padded.layout.content, chosen);

  // Layout files are validated whole: a report or a bare layout, complete padding only.
  deepStrictEqual(readLayoutJson({ ok: true, layout }), layout);
  deepStrictEqual(readLayoutJson(layout), layout);
  throws(() => readLayoutJson({ layout: { ...layout, content: { left: 0 } } }));
  throws(() => readLayoutJson({ x: layout.x }));

  const wrongSize = inspectRaster(art, { ...defaultInspectOptions, layout });
  ok(codes(wrongSize.findings).includes('layout.size'));

  const overDetail = {
    x: { length: 240, segments: [{ start: 0, end: 240, kind: 'stretch' as const }] },
    y: layoutFromInsets({ left: 0, right: 0, top: 20, bottom: 20 }, 240, 100, {
      shape: 'nine',
      tile: { x: false, y: false },
    }).y,
  };
  ok(
    codes(inspectRaster(art, { ...defaultInspectOptions, layout: overDetail }).findings).includes(
      'stretch.x.nonuniform',
    ),
  );
  throws(() =>
    inspectRaster(art, {
      ...defaultInspectOptions,
      layout: { x: { length: 240, segments: [] }, y: overDetail.y },
    }),
  );
}

void test('multi-region layout files', readsBackMultiRegionLayouts);
void test('target capabilities', checksTargetCapabilities);
void test('CSS border-image', exportsCssBorderImage);
