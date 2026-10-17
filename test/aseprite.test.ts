import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { test } from 'node:test';

import { inspectAsepriteSlices, isAsepriteSheet } from '../src/aseprite.js';
import { defaultInspectOptions } from '../src/inspect.js';
import { createRaster } from '../src/raster.js';
import { panel } from './fixtures.js';

const app = 'https://www.aseprite.org/';

/** Two 40x30 panels side by side, as an Aseprite sheet of two frames. */
function sheetImage(): ReturnType<typeof createRaster> {
  const image = createRaster(80, 30);
  const button = panel(40, 30);
  for (let y = 0; y < 30; y += 1) {
    image.data.set(button.data.subarray(y * 160, y * 160 + 160), y * 320);
    image.data.set(button.data.subarray(y * 160, y * 160 + 160), y * 320 + 160);
  }
  return image;
}

const frames = {
  'button 0.aseprite': { frame: { x: 0, y: 0, w: 40, h: 30 }, duration: 100 },
  'button 1.aseprite': { frame: { x: 40, y: 0, w: 40, h: 30 }, duration: 100 },
};

function codes(findings: ReadonlyArray<{ readonly code: string }> | undefined): string[] {
  return (findings ?? []).map((finding) => finding.code);
}

/**
 * @evidence docs/spec.md#aseprite-slices Checks keys spanning frames, a trimmed frame, centers that cut detail or leave the bounds, a full-height center, slices without a center, and keys past the last frame.
 * @evidenceReview docs/spec.md#aseprite-slices #8c1cbc8 Checked the assertions against the section's detection, key range, mapping, error, and three-slice rules and ran this test green with pnpm test.
 */
export function checksAsepriteSlices(): void {
  const image = sheetImage();
  const bounds = { x: 0, y: 0, w: 40, h: 30 };
  ok(isAsepriteSheet({ frames, meta: { app, slices: [] } }));
  ok(isAsepriteSheet({ frames, meta: { slices: [] } }));
  ok(!isAsepriteSheet({ frames, meta: { image: 'ui.png' } }));
  ok(!isAsepriteSheet([]));

  // One key covers both frames; a center that cuts the rim fails on its pixels.
  const report = inspectAsepriteSlices(
    {
      frames,
      meta: {
        app,
        image: 'button.png',
        size: { w: 80, h: 30 },
        slices: [
          {
            name: 'button',
            keys: [
              { frame: 0, bounds, center: { x: 6, y: 6, w: 28, h: 18 }, pivot: { x: 20, y: 15 } },
            ],
          },
          { name: 'tight', keys: [{ frame: 0, bounds, center: { x: 2, y: 6, w: 36, h: 18 } }] },
          { name: 'bar', keys: [{ frame: 1, bounds, center: { x: 6, y: 0, w: 28, h: 30 } }] },
          { name: 'track', keys: [{ frame: 1, bounds, center: { x: 0, y: 6, w: 40, h: 18 } }] },
          { name: 'hitbox', keys: [{ frame: 0, bounds }] },
        ],
      },
    },
    image,
    defaultInspectOptions,
  );
  strictEqual(report.format, 'aseprite');
  strictEqual(report.frameLayout, 'hash');
  strictEqual(report.ok, false);
  deepStrictEqual(
    report.slices.map((slice) => [slice.name, slice.ok, slice.frames.map((frame) => frame.frame)]),
    [
      ['button', true, [0, 1]],
      ['tight', false, [0, 1]],
      ['bar', true, [1]],
      ['track', true, [1]],
    ],
  );
  const button = report.slices[0]?.frames[1];
  deepStrictEqual(button?.insets, { left: 6, right: 6, top: 6, bottom: 6 });
  deepStrictEqual(button?.pivot, { x: 20, y: 15 });
  strictEqual(button?.frameName, 'button 1.aseprite');
  strictEqual(button?.key, 0);
  ok(codes(report.slices[1]?.frames[0]?.inspection?.findings).includes('stretch.x.nonuniform'));
  strictEqual(report.slices[2]?.frames[0]?.inspection?.mode, 'three');
  strictEqual(report.slices[3]?.frames[0]?.inspection?.mode, 'three-vertical');

  // A slice without a center is checked by name, for its bounds only.
  const hitbox = inspectAsepriteSlices(
    { frames, meta: { app, slices: [{ name: 'hitbox', keys: [{ frame: 0, bounds }] }] } },
    image,
    defaultInspectOptions,
    'hitbox',
  );
  ok(hitbox.ok);
  deepStrictEqual(codes(hitbox.slices[0]?.findings), ['aseprite.no-center']);
  strictEqual(hitbox.slices[0]?.frames[0]?.inspection, undefined);

  // Trimmed frames map canvas bounds through spriteSourceSize.
  const trimmed = {
    filename: 'trimmed',
    frame: { x: 40, y: 0, w: 40, h: 30 },
    trimmed: true,
    spriteSourceSize: { x: 4, y: 2, w: 40, h: 30 },
    sourceSize: { w: 48, h: 34 },
  };
  const center = { x: 6, y: 6, w: 28, h: 18 };
  const array = inspectAsepriteSlices(
    {
      frames: [trimmed, { ...trimmed, filename: 'turned', rotated: true }],
      meta: {
        app,
        slices: [
          { name: 'kept', keys: [{ frame: 0, bounds: { x: 4, y: 2, w: 40, h: 30 }, center }] },
          { name: 'cut', keys: [{ frame: 0, bounds, center }] },
          {
            name: 'wide',
            keys: [{ frame: 0, bounds: { x: 4, y: 2, w: 40, h: 30 }, center: { ...center, w: 40 } }],
          },
          { name: 'late', keys: [{ frame: 5, bounds, center }] },
          { name: 'half', keys: [{ frame: 0, bounds: { ...bounds, w: 0.5 }, center }] },
        ],
      },
    },
    image,
    defaultInspectOptions,
  );
  strictEqual(array.frameLayout, 'array');
  deepStrictEqual(
    array.slices.map((slice) => [
      slice.name,
      slice.ok,
      [...codes(slice.findings), ...slice.frames.flatMap((frame) => codes(frame.findings))],
    ]),
    [
      ['kept', false, ['aseprite.rotated']],
      ['cut', false, ['aseprite.bounds-outside-frame', 'aseprite.rotated']],
      ['wide', false, ['aseprite.center-invalid', 'aseprite.rotated']],
      ['late', false, ['aseprite.frame-missing']],
      ['half', false, ['aseprite.bounds-invalid', 'aseprite.rotated']],
    ],
  );
  ok(array.slices[0]?.frames[0]?.ok);

  // Coordinates too large for exact sums are not whole pixels.
  const huge = inspectAsepriteSlices(
    {
      frames: [
        {
          filename: 'huge',
          frame: { x: 0, y: 0, w: 40, h: 30 },
          trimmed: true,
          spriteSourceSize: { x: 1e20, y: 0, w: 40, h: 30 },
          sourceSize: { w: 1e20, h: 30 },
        },
      ],
      meta: {
        app,
        slices: [
          { name: 'huge', keys: [{ frame: 0, bounds: { x: 1e20, y: 0, w: 40, h: 30 }, center }] },
        ],
      },
    },
    image,
    defaultInspectOptions,
  );
  deepStrictEqual(
    huge.slices[0]?.frames.map((frame) => codes(frame.findings)),
    [['aseprite.bounds-invalid']],
  );

  // A fractional frame or kept rectangle would crop shifted pixels.
  const fractional = inspectAsepriteSlices(
    {
      frames: [
        { filename: 'half', frame: { x: 0.5, y: 0, w: 40, h: 30 } },
        { ...trimmed, spriteSourceSize: { x: 4, y: 2.5, w: 40, h: 30 } },
        { filename: 'off', frame: { x: -10, y: 0, w: 40, h: 30 } },
        {
          filename: 'shifted',
          frame: { x: 0, y: 0, w: 40, h: 30 },
          spriteSourceSize: { x: -4, y: 0, w: 40, h: 30 },
          sourceSize: { w: 40, h: 30 },
        },
      ],
      meta: {
        app,
        slices: [
          { name: 'button', keys: [{ frame: 0, bounds: { x: 4, y: 2, w: 36, h: 28 }, center }] },
        ],
      },
    },
    image,
    defaultInspectOptions,
  );
  deepStrictEqual(
    fractional.slices[0]?.frames.map((frame) => codes(frame.findings)),
    [
      ['atlas.frame-outside-image'],
      ['atlas.frame-outside-image'],
      ['atlas.frame-outside-image'],
      ['aseprite.bounds-outside-frame'],
    ],
  );
  deepStrictEqual(array.slices[0]?.frames[0]?.insets, { left: 6, right: 6, top: 6, bottom: 6 });

  // A zero-size key hides the slice; a far-off next key does not loop past the sheet.
  const hiding = inspectAsepriteSlices(
    {
      frames,
      meta: {
        app,
        slices: [
          {
            name: 'blink',
            keys: [
              { frame: 0, bounds, center: { x: 6, y: 6, w: 28, h: 18 } },
              { frame: 1, bounds: { x: 0, y: 0, w: 0, h: 0 } },
            ],
          },
          {
            name: 'far',
            keys: [
              { frame: 0, bounds, center: { x: 6, y: 6, w: 28, h: 18 } },
              { frame: 1_000_000_000, bounds, center: { x: 6, y: 6, w: 28, h: 18 } },
            ],
          },
        ],
      },
    },
    image,
    defaultInspectOptions,
  );
  deepStrictEqual(
    hiding.slices.map((slice) => [
      slice.name,
      slice.ok,
      slice.frames.map((frame) => frame.frame),
      codes(slice.findings),
    ]),
    [
      ['blink', true, [0], []],
      ['far', false, [0, 1], ['aseprite.frame-missing']],
    ],
  );

  // A trimmed frame must say where its kept pixels sit on the canvas.
  const unplaced = inspectAsepriteSlices(
    {
      frames: [{ filename: 'cut', frame: { x: 0, y: 0, w: 40, h: 30 }, trimmed: true }],
      meta: {
        app,
        slices: [
          { name: 'button', keys: [{ frame: 0, bounds, center: { x: 6, y: 6, w: 28, h: 18 } }] },
        ],
      },
    },
    image,
    defaultInspectOptions,
  );
  deepStrictEqual(codes(unplaced.slices[0]?.frames[0]?.findings), [
    'aseprite.bounds-outside-frame',
  ]);

  // Inner padding shifts the kept pixels into the frame, evenly on both sides.
  const padded = inspectAsepriteSlices(
    {
      frames: [
        {
          filename: 'padded',
          frame: { x: 0, y: 0, w: 40, h: 30 },
          spriteSourceSize: { x: 0, y: 0, w: 38, h: 28 },
          sourceSize: { w: 38, h: 28 },
        },
        {
          filename: 'uneven',
          frame: { x: 40, y: 0, w: 40, h: 30 },
          spriteSourceSize: { x: 0, y: 0, w: 37, h: 28 },
          sourceSize: { w: 37, h: 28 },
        },
      ],
      meta: {
        app,
        slices: [
          {
            name: 'button',
            keys: [
              {
                frame: 0,
                bounds: { x: 0, y: 0, w: 36, h: 28 },
                center: { x: 6, y: 6, w: 24, h: 16 },
              },
            ],
          },
        ],
      },
    },
    image,
    defaultInspectOptions,
  );
  strictEqual(padded.slices[0]?.frames[0]?.inspection?.width, 36);
  deepStrictEqual(codes(padded.slices[0]?.frames[1]?.findings), ['aseprite.bounds-outside-frame']);
  throws(() =>
    inspectAsepriteSlices(
      { frames, meta: { app, slices: [{ name: 'empty', keys: [] }] } },
      image,
      defaultInspectOptions,
    ),
  );

  // Missing and absent slices.
  const missing = inspectAsepriteSlices(
    { frames, meta: { app, slices: [] } },
    image,
    defaultInspectOptions,
    'nope',
  );
  deepStrictEqual(codes(missing.findings), ['aseprite.slice-missing']);
  strictEqual(missing.ok, false);
  const none = inspectAsepriteSlices({ frames, meta: { app } }, image, defaultInspectOptions);
  deepStrictEqual(codes(none.findings), ['aseprite.no-slices']);
  ok(none.ok);
}

void test('aseprite slices', checksAsepriteSlices);
