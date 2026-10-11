import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { test } from 'node:test';

import { encode } from 'fast-png';

import { defaultInspectOptions, inspectRaster } from '../src/inspect.js';
import { createSingleFrameAtlas, inspectAtlas } from '../src/phaser.js';
import { decodePng, encodePng } from '../src/png.js';
import { buildPromptPlan } from '../src/prompt.js';
import { createRaster, pixelOffset } from '../src/raster.js';
import { renderPreviewSheet, renderSlices } from '../src/render.js';
import { insetsToScale9Borders, isThreeSlice, scale9BordersToInsets } from '../src/slices.js';
import { fillRect, ornament, panel, sameRaster, shadedBar } from './fixtures.js';

function pixel(raster: ReturnType<typeof createRaster>, x: number, y: number): number[] {
  const offset = pixelOffset(raster, x, y);
  return Array.from(raster.data.subarray(offset, offset + 4));
}

/**
 * @evidence docs/spec.md#png-input Round-trips RGBA8, keeps the high byte of 16-bit RGB, and refuses non-PNG bytes.
 * @evidenceReview docs/spec.md#png-input #4d0f875 Checked the assertions against the section and ran this test green with pnpm test.
 */
export function convertsPngLayoutsToRgba(): void {
  const source = panel(20, 16, 2);
  ok(sameRaster(decodePng(encodePng(source)), source));

  const wide = encode({
    width: 1,
    height: 1,
    depth: 16,
    channels: 3,
    data: new Uint16Array([0x1234, 0xabcd, 0xff00]),
  });
  deepStrictEqual(pixel(decodePng(wide), 0, 0), [0x12, 0xab, 0xff, 255]);

  const gray = encode({
    width: 2,
    height: 1,
    depth: 8,
    channels: 2,
    data: new Uint8Array([10, 20, 30, 40]),
  });
  deepStrictEqual(pixel(decodePng(gray), 1, 0), [30, 30, 30, 40]);

  throws(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])), /Not a PNG/);
}

/**
 * @evidence docs/spec.md#preview-sheet Renders the source size losslessly, keeps corners at larger sizes, tiles whole periods, and lays out the sheet cells.
 * @evidenceReview docs/spec.md#preview-sheet #ec2d281 Checked the assertions against the section and ran this test green with pnpm test.
 */
export function rendersSlicesAndPreviewSheets(): void {
  const source = panel(40, 30);
  const { insets, mode } = inspectRaster(source);
  ok(sameRaster(renderSlices(source, insets, 40, 30), source));

  const large = renderSlices(source, insets, 120, 90);
  strictEqual(large.width, 120);
  deepStrictEqual(pixel(large, 3, 3), [...ornament]);
  deepStrictEqual(pixel(large, 116, 86), [...ornament]);
  deepStrictEqual(pixel(large, 60, 45), pixel(source, 20, 15));

  const clamped = renderSlices(source, insets, 4, 4);
  deepStrictEqual([clamped.width, clamped.height], [12, 12]);

  const stripes = createRaster(12, 2);
  for (let x = 0; x < 12; x += 1) {
    fillRect(stripes, x, 0, 1, 2, x % 2 === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
  }
  const tiled = renderSlices(stripes, { left: 2, right: 2, top: 0, bottom: 0 }, 20, 2, {
    tileX: true,
    tileY: false,
  });
  const row = Array.from({ length: 20 }, (_, x) => pixel(tiled, x, 0)[0]);
  deepStrictEqual(
    row,
    Array.from({ length: 20 }, (_, x) => (x % 2 === 0 ? 255 : 0)),
  );

  const sheet = renderPreviewSheet(source, inspectRaster(source).layout);
  deepStrictEqual(
    sheet.cells.map((cell) => cell.label),
    ['guides', 'source', 'min', 'wide', 'tall', 'double'],
  );
  const double = sheet.cells.at(-1);
  deepStrictEqual([double?.width, double?.height], [80, 60]);
  ok(sheet.raster.width > 40 * 6);

  const bar = shadedBar(48, 12);
  const barReport = inspectRaster(bar);
  const barSheet = renderPreviewSheet(bar, barReport.layout);
  strictEqual(
    barSheet.cells.some((cell) => cell.label === 'tall'),
    false,
  );
  ok(barSheet.cells.every((cell) => cell.height === 12));
}

/**
 * @evidence docs/spec.md#phaser-scale9borders Converts both ways, applies Phaser's three-slice rule, and writes a loadable one-frame atlas.
 * @evidenceReview docs/spec.md#phaser-scale9borders #d192956 Checked the assertions against the section and ran this test green with pnpm test.
 */
export function convertsToPhaserBorders(): void {
  const insets = { left: 6, right: 8, top: 5, bottom: 7 };
  const borders = insetsToScale9Borders(insets, 40, 30);
  deepStrictEqual(borders, { x: 6, y: 5, w: 26, h: 18 });
  deepStrictEqual(scale9BordersToInsets(borders, 40, 30), insets);

  const three = scale9BordersToInsets({ x: 5, y: 0, w: 38, h: 12 }, 48, 12);
  strictEqual(isThreeSlice(three), true);

  const atlas = createSingleFrameAtlas('button', 'button.png', 40, 30, insets);
  deepStrictEqual(atlas.frames['button'], {
    frame: { x: 0, y: 0, w: 40, h: 30 },
    rotated: false,
    trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w: 40, h: 30 },
    sourceSize: { w: 40, h: 30 },
    scale9Borders: borders,
  });
  strictEqual(atlas.meta?.image, 'button.png');
}

/**
 * @evidence docs/spec.md#atlas-frames Checks hash and array atlases for trimming, rotation, out-of-frame borders, missing frames, and frame pixels.
 * @evidenceReview docs/spec.md#atlas-frames #62396a0 Checked the assertions against the section and ran this test green with pnpm test.
 */
export function checksAtlasFrames(): void {
  const image = createRaster(80, 30);
  const button = panel(40, 30);
  for (let y = 0; y < 30; y += 1) {
    image.data.set(button.data.subarray(y * 160, y * 160 + 160), y * 320);
    image.data.set(button.data.subarray(y * 160, y * 160 + 160), y * 320 + 160);
  }
  const frame = { x: 0, y: 0, w: 40, h: 30 };
  const borders = { x: 6, y: 6, w: 28, h: 18 };

  const hash = inspectAtlas(
    {
      frames: {
        good: { frame, scale9Borders: borders, trimmed: false },
        trimmed: { frame: { ...frame, x: 40 }, scale9Borders: borders, trimmed: true },
        plain: { frame },
      },
      meta: { image: 'ui.png', size: { w: 80, h: 30 } },
    },
    image,
    defaultInspectOptions,
  );
  strictEqual(hash.format, 'hash');
  deepStrictEqual(
    hash.frames.map((item) => [item.name, item.ok]),
    [
      ['good', true],
      ['trimmed', false],
    ],
  );
  ok(hash.frames[1]?.findings.some((item) => item.code === 'atlas.trimmed'));

  const array = inspectAtlas(
    {
      frames: [
        { filename: 'rotated', frame, rotated: true, scale9Borders: borders },
        { filename: 'outside', frame, scale9Borders: { x: 6, y: 6, w: 40, h: 18 } },
        { filename: 'stretchy', frame, scale9Borders: { x: 2, y: 6, w: 32, h: 18 } },
      ],
    },
    image,
    defaultInspectOptions,
  );
  strictEqual(array.format, 'array');
  const byName = new Map(array.frames.map((item) => [item.name, item]));
  strictEqual(byName.get('rotated')?.ok, true);
  ok(byName.get('rotated')?.findings.some((item) => item.code === 'atlas.rotated'));
  ok(byName.get('outside')?.findings.some((item) => item.code === 'atlas.borders-outside-frame'));
  ok(
    byName
      .get('stretchy')
      ?.inspection?.findings.some((item) => item.code === 'stretch.x.nonuniform'),
  );
  strictEqual(array.ok, false);

  const missing = inspectAtlas({ frames: {} }, image, defaultInspectOptions, 'nope');
  ok(missing.findings.some((item) => item.code === 'atlas.frame-missing'));
  throws(() => inspectAtlas({ textures: [] }, image, defaultInspectOptions));
}

/**
 * @evidence docs/spec.md#generation-prompts Plans structural prompts, three-slice bars, chroma backgrounds, and follow-up steps.
 * @evidenceReview docs/spec.md#generation-prompts #67de005 Checked the assertions against the section and ran this test green with pnpm test.
 */
export function plansGenerationPrompts(): void {
  const button = buildPromptPlan({
    kind: 'button',
    style: 'glossy candy UI',
    background: 'transparent',
    pixelArt: false,
  });
  strictEqual(button.mode, 'nine');
  ok(button.prompt.startsWith('A single game UI button background, glossy candy UI.'));
  ok(button.prompt.includes('No text'));
  ok(button.prompt.includes('decoration in the four corners'));
  ok(button.prompt.includes('no rope, chain'));
  ok(button.avoid.some((item) => item.includes('running along the edges')));
  ok(button.prompt.includes('Transparent background'));
  ok(button.avoid.includes('text or icons on the element'));

  const bar = buildPromptPlan({
    kind: 'bar',
    style: '16-bit fantasy',
    background: 'chroma-green',
    pixelArt: true,
  });
  strictEqual(bar.mode, 'three');
  ok(bar.prompt.includes('stretched horizontally only'));
  ok(bar.prompt.includes('two end caps'));
  ok(bar.prompt.includes('#00FF00'));
  ok(bar.prompt.includes('pixel art'));
  ok(bar.afterGeneration[0]?.includes('despill'));
  ok(bar.afterGeneration.some((step) => step.includes('slicewright inspect')));
}

void test('PNG input', convertsPngLayoutsToRgba);
void test('rendering and preview sheets', rendersSlicesAndPreviewSheets);
void test('Phaser scale9Borders', convertsToPhaserBorders);
void test('atlas frames', checksAtlasFrames);
void test('generation prompts', plansGenerationPrompts);
