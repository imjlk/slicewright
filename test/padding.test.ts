import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { test } from 'node:test';

import { defaultInspectOptions, inspectRaster } from '../src/inspect.js';
import { inspectAtlas } from '../src/phaser.js';
import { createRaster, pixelOffset } from '../src/raster.js';
import { renderPreviewSheet } from '../src/render.js';
import { exportForTarget } from '../src/targets/index.js';
import { clear, fill, fillRect, panel } from './fixtures.js';

function text(contents: string | Uint8Array | undefined): string {
  return typeof contents === 'string' ? contents : '';
}

/**
 * @evidence docs/spec.md#content-padding Detects padding on flat, shaded, empty-centered, and borderless art, validates given padding, exports it to Phaser and CSS, checks it in atlases, and outlines it in the preview.
 * @evidenceReview docs/spec.md#content-padding #d8f1459 Checked the assertions against the section and ran this test green with pnpm test.
 */
export function detectsContentPadding(): void {
  const flat = inspectRaster(panel(40, 30));
  deepStrictEqual(flat.contentPadding, { left: 6, right: 6, top: 6, bottom: 6 });
  strictEqual(flat.contentPaddingSource, 'detected');

  // A smooth vertical gradient in the fill never stops a walk.
  const shaded = panel(60, 40);
  for (let y = 6; y < 34; y += 1) {
    fillRect(shaded, 6, y, 48, 1, [60 + y * 2, 60, 40, 255]);
  }
  deepStrictEqual(inspectRaster(shaded).contentPadding, { left: 6, right: 6, top: 6, bottom: 6 });

  // An empty frame center ends at the frame's alpha edge.
  const frame = panel(40, 30);
  fillRect(frame, 6, 6, 28, 18, clear);
  deepStrictEqual(inspectRaster(frame).contentPadding, { left: 6, right: 6, top: 6, bottom: 6 });

  // No frame at all: every walk reaches the image edge.
  const plain = createRaster(20, 12);
  fillRect(plain, 0, 0, 20, 12, fill);
  deepStrictEqual(inspectRaster(plain).contentPadding, { left: 0, right: 0, top: 0, bottom: 0 });

  const given = inspectRaster(panel(40, 30), {
    ...defaultInspectOptions,
    contentPadding: { left: 3, right: 3, top: 4, bottom: 4 },
  });
  strictEqual(given.contentPaddingSource, 'given');
  deepStrictEqual(given.contentPadding, { left: 3, right: 3, top: 4, bottom: 4 });
  // Given padding past the fixed edge would scale with the art, so it is refused.
  const pastInset = inspectRaster(panel(40, 30), {
    ...defaultInspectOptions,
    contentPadding: { left: 9, right: 3, top: 4, bottom: 4 },
  });
  ok(pastInset.findings.some((finding) => finding.code === 'padding.invalid'));

  // A detected inner edge inside a stretch span is clamped to the fixed edge.
  const deep = panel(40, 30);
  fillRect(deep, 6, 6, 4, 18, [200, 160, 90, 255]);
  const clamped = inspectRaster(deep, {
    ...defaultInspectOptions,
    insets: { left: 6, right: 6, top: 6, bottom: 6 },
  });
  strictEqual(clamped.contentPadding?.left, 6);
  ok(clamped.findings.some((finding) => finding.code === 'padding.clamped'));

  // A target refuses padding that does not fit the image, like a layout of another size.
  throws(
    () =>
      exportForTarget('css', {
        name: 'panel',
        imageRef: 'panel.png',
        raster: panel(40, 30),
        layout: { ...flat.layout, content: { left: 30, right: 30, top: 4, bottom: 4 } },
      }),
    RangeError,
  );

  const invalid = inspectRaster(panel(40, 30), {
    ...defaultInspectOptions,
    contentPadding: { left: 20, right: 20, top: 4, bottom: 4 },
  });
  strictEqual(invalid.ok, false);
  ok(invalid.findings.some((finding) => finding.code === 'padding.invalid'));

  // Phaser keeps the padding in the frame and the usage names where to read it.
  const raster = panel(40, 30);
  const padding = { left: 3, right: 3, top: 4, bottom: 4 };
  // Padding travels in the layout, so every target and transform sees the same value.
  const layout = given.layout;
  deepStrictEqual(layout.content, padding);
  const phaser = exportForTarget('phaser', {
    name: 'panel',
    imageRef: 'panel.png',
    raster,
    layout,
  });
  const atlas = JSON.parse(text(phaser.files[0]?.contents)) as {
    frames: Record<string, { slicewright?: { contentPadding?: unknown } }>;
  };
  deepStrictEqual(atlas.frames['panel']?.slicewright?.contentPadding, padding);
  ok(phaser.usage.includes('customData.slicewright.contentPadding'));
  strictEqual(inspectAtlas(atlas, raster, defaultInspectOptions).ok, true);

  // CSS sizes the content box with border-width and draws the art at its slices.
  const css = text(
    exportForTarget('css', {
      name: 'panel',
      imageRef: 'panel.png',
      raster,
      layout,
    }).files[0]?.contents,
  );
  ok(css.includes('border-width: 4px 3px 4px 3px;'));
  ok(css.includes('border-image-width: 6px 6px 6px 6px;'));
  ok(css.includes('min-width: 12px;'));

  // Padding that does not fit the frame is refused by the atlas check.
  const broken = JSON.parse(text(phaser.files[0]?.contents)) as {
    frames: Record<string, { slicewright: { contentPadding: { left: number } } }>;
  };
  for (const entry of Object.values(broken.frames)) {
    entry.slicewright.contentPadding.left = 40;
  }
  const brokenReport = inspectAtlas(broken, raster, defaultInspectOptions);
  ok(brokenReport.frames[0]?.findings.some((finding) => finding.code === 'atlas.padding-invalid'));

  // The guides cell outlines the content box.
  const sheet = renderPreviewSheet(raster, layout);
  const guides = sheet.cells[0];
  const at = pixelOffset(sheet.raster, (guides?.x ?? 0) + 3, (guides?.y ?? 0) + 4);
  deepStrictEqual(Array.from(sheet.raster.data.subarray(at, at + 4)), [0, 220, 255, 255]);
}

void test('content padding', detectsContentPadding);
