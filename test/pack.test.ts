import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { defaultInspectOptions, inspectRaster } from '../src/inspect.js';
import { buildPack, PackInputError } from '../src/pack-files.js';
import { defaultPackOptions, packFrames, type PackPiece } from '../src/pack.js';
import { frameLayout, inspectAtlas, type PhaserJsonHashAtlas } from '../src/phaser.js';
import { decodePng } from '../src/png.js';
import { cropRaster, pixelOffset, type Raster } from '../src/raster.js';
import { exportForTarget } from '../src/targets/index.js';
import { phaserUsage } from '../src/targets/phaser.js';
import { panel, ropePanel, sameRaster, shadedBar } from './fixtures.js';

/** A piece as the Phaser target exports it: its one-frame atlas data. */
function exported(name: string, raster: Raster): PackPiece {
  const { layout } = inspectRaster(raster);
  const contents = exportForTarget('phaser', { name, imageRef: `${name}.png`, raster, layout })
    .files[0]?.contents;
  const atlas = JSON.parse(typeof contents === 'string' ? contents : '{}') as PhaserJsonHashAtlas;
  const frame = atlas.frames[name];
  return {
    name,
    raster,
    data: {
      ...(frame?.scale9Borders === undefined ? {} : { scale9Borders: frame.scale9Borders }),
      ...(frame?.slicewright === undefined ? {} : { slicewright: frame.slicewright }),
    },
  };
}

function pixel(raster: Raster, x: number, y: number): number[] {
  const at = pixelOffset(raster, x, y);
  return Array.from(raster.data.subarray(at, at + 4));
}

/**
 * @evidence docs/spec.md#atlas-packing Packs a panel, a bar, and a tiled rope panel: exact pixels, extrusion, spacing, kept borders and slicewright data, a passing atlas check, one usage, and refused inputs.
 * @evidenceReview docs/spec.md#atlas-packing #13ea142 Checked the assertions against the section and ran this test green with pnpm test.
 */
export function packsAtlases(): void {
  const pieces = [
    exported('panel', panel(40, 30)),
    exported('bar', shadedBar(48, 12)),
    exported('rope', ropePanel(96, 40)),
  ];
  // The Phaser target records the tiled axis in the frame.
  deepStrictEqual(pieces[2]?.data.slicewright?.tile, { x: true, y: false });

  const packed = packFrames(pieces, 'ui.png');
  // Atlas frames keep the given order; shelves place the tallest first.
  deepStrictEqual(Object.keys(packed.atlas.frames), ['panel', 'bar', 'rope']);
  deepStrictEqual(packed.atlas.meta?.size, { w: packed.raster.width, h: packed.raster.height });

  for (const piece of pieces) {
    const frame = packed.atlas.frames[piece.name];
    ok(frame !== undefined);
    const { x, y, w, h } = frame.frame;
    // Pixels are copied exactly; the frame is untrimmed and unrotated.
    ok(sameRaster(cropRaster(packed.raster, { x, y, width: w, height: h }), piece.raster));
    strictEqual(frame.trimmed, false);
    strictEqual(frame.rotated, false);
    deepStrictEqual(frame.spriteSourceSize, { x: 0, y: 0, w, h });
    deepStrictEqual(frame.scale9Borders, piece.data.scale9Borders);
    deepStrictEqual(frame.slicewright, piece.data.slicewright);
    // One pixel of extrusion repeats the frame's own corner and edge pixels.
    deepStrictEqual(pixel(packed.raster, x - 1, y - 1), pixel(piece.raster, 0, 0));
    deepStrictEqual(pixel(packed.raster, x + w, y + 3), pixel(piece.raster, w - 1, 3));
    // Past the extrusion, spacing is transparent wherever the sheet goes on.
    if (x - 2 >= 0) {
      strictEqual(pixel(packed.raster, x - 2, y)[3], 0);
    }
  }
  // Extruded cells never overlap, and keep the spacing between them.
  const cells = packed.frames.map((frame) => ({
    left: frame.x - 1,
    top: frame.y - 1,
    right: frame.x + frame.width + 1,
    bottom: frame.y + frame.height + 1,
  }));
  for (const [index, a] of cells.entries()) {
    for (const b of cells.slice(index + 1)) {
      ok(
        a.right + 2 <= b.left ||
          b.right + 2 <= a.left ||
          a.bottom + 2 <= b.top ||
          b.bottom + 2 <= a.top,
      );
    }
  }

  // The packed atlas passes the same check, tiled axis and padding included.
  const report = inspectAtlas(packed.atlas, packed.raster, defaultInspectOptions);
  strictEqual(report.ok, true);
  const rope = report.frames.find((frame) => frame.name === 'rope');
  strictEqual(rope?.inspection?.tile.x, true);
  const panelFrame = packed.atlas.frames['panel'];
  deepStrictEqual(
    panelFrame === undefined ? undefined : frameLayout(panelFrame),
    inspectRaster(panel(40, 30)).layout,
  );

  // One load call and a NineSlice per frame, with tiling flags where needed.
  const usage = phaserUsage('ui', 'ui/ui.png', 'ui/ui.json', [
    { name: 'panel', tile: { x: false, y: false }, note: '', contentPadding: true },
    {
      name: 'bar',
      tile: { x: false, y: false },
      note: ' Keep the height at 12 px.',
      contentPadding: false,
    },
    { name: 'rope', tile: { x: true, y: false }, note: '', contentPadding: false },
  ]);
  strictEqual(usage.match(/this\.load\.atlas/g)?.length, 1);
  ok(
    usage.includes(
      'this.add.nineslice(x, y, "ui", "bar", width, height);\n// Keep the height at 12 px.',
    ),
  );
  ok(
    usage.includes(
      '"rope", width, height, undefined, undefined, undefined, undefined, true, false);',
    ),
  );
  ok(usage.includes('this.textures.getFrame("ui", "panel").customData.slicewright.contentPadding'));

  // No extrusion and no spacing pack frames edge to edge.
  const tight = packFrames(pieces, 'ui.png', { spacing: 0, extrude: 0 });
  ok(tight.raster.width * tight.raster.height < packed.raster.width * packed.raster.height);
  strictEqual(inspectAtlas(tight.atlas, tight.raster, defaultInspectOptions).ok, true);

  throws(() => packFrames([pieces[0] as PackPiece, pieces[0] as PackPiece], 'ui.png'), /unique/);
  throws(() => packFrames([], 'ui.png'), RangeError);
  // Frame names are data: one named __proto__ is still a frame.
  const proto = packFrames([{ ...(pieces[0] as PackPiece), name: '__proto__' }], 'ui.png');
  deepStrictEqual(Object.keys(proto.atlas.frames), ['__proto__']);
  throws(() => packFrames(pieces, 'ui.png', { spacing: -1, extrude: 1 }), RangeError);
  throws(() => packFrames(pieces, 'ui.png', { spacing: 2, extrude: 1.5 }), RangeError);
}

/**
 * @evidence docs/spec.md#atlas-packing Packs committed atlases from files: one load call, tiling flags, a stylesheet whose classes point at each frame's own image, no classes for frames that are part of an image, and refused trimmed frames.
 * @evidenceReview docs/spec.md#atlas-packing #13ea142 Checked the assertions against the section and ran this test green with pnpm test.
 */
export function packsAtlasFiles(): void {
  const dir = mkdtempSync(join(tmpdir(), 'slicewright-pack-'));
  try {
    const options = {
      ...defaultPackOptions,
      css: true,
      match: defaultInspectOptions,
      servedFrom: dir,
    };
    const result = buildPack({
      ...options,
      inputs: ['examples/real/button.json', 'examples/tiled/rope.json'],
      out: join(dir, 'ui.png'),
      name: 'ui',
    });
    strictEqual(result.ok, true);
    deepStrictEqual(
      result.files.map((file) => file.path),
      [join(dir, 'ui.png'), join(dir, 'ui.json'), join(dir, 'ui.css')],
    );
    ok(result.usage.startsWith('this.load.atlas("ui", "ui.png", "ui.json");\n'));
    ok(
      result.usage.includes(
        '"rope", width, height, undefined, undefined, undefined, undefined, true, false);',
      ),
    );
    const css = String(result.files[2]?.contents);
    ok(/border-image-source: url\("[^"]*examples\/real\/button\.png"\);/.test(css));
    ok(css.includes('.rope {') && css.includes('border-image-repeat: round stretch;'));
    ok(result.usage.includes('<div class="button">…</div>'));

    // Frames of a packed atlas are only part of its image: they repack, but get no CSS class.
    for (const file of result.files) {
      writeFileSync(file.path, file.contents);
    }
    const again = buildPack({
      ...options,
      inputs: [join(dir, 'ui.json')],
      out: join(dir, 'again.png'),
      name: 'again',
    });
    strictEqual(again.ok, true);
    deepStrictEqual(
      again.cssFindings.map((finding) => finding.code),
      ['pack.css-skipped', 'pack.css-skipped'],
    );
    // With no class to write, there is no stylesheet to link.
    strictEqual(again.files.length, 2);
    strictEqual(again.usage.includes('<link'), false);
    // Packing must not overwrite its inputs or their companion files.
    throws(
      () =>
        buildPack({
          ...options,
          inputs: [join(dir, 'ui.json')],
          out: join(dir, 'ui.png'),
          name: 'ui',
        }),
      /would overwrite/,
    );
    throws(
      () =>
        buildPack({
          ...options,
          inputs: [join(dir, 'ui.json')],
          out: join(dir, 'other.png'),
          name: 'ui',
        }),
      /would overwrite/,
    );
    const first = decodePng(readFileSync(join(dir, 'ui.png')));
    const second = decodePng(again.files[0]?.contents as Uint8Array);
    for (const frame of again.frames) {
      const before = result.frames.find((item) => item.name === frame.name);
      ok(before !== undefined);
      ok(
        sameRaster(
          cropRaster(second, { x: frame.x, y: frame.y, width: frame.width, height: frame.height }),
          cropRaster(first, {
            x: before.x,
            y: before.y,
            width: before.width,
            height: before.height,
          }),
        ),
      );
    }

    // A trimmed input frame cannot be copied as it renders.
    const atlas = JSON.parse(readFileSync(join(dir, 'ui.json'), 'utf8')) as {
      frames: Record<string, { trimmed: boolean }>;
    };
    for (const frame of Object.values(atlas.frames)) {
      frame.trimmed = true;
    }
    writeFileSync(join(dir, 'trimmed.json'), JSON.stringify(atlas));
    throws(
      () =>
        buildPack({
          ...options,
          inputs: [join(dir, 'trimmed.json')],
          out: join(dir, 't.png'),
          name: 't',
        }),
      PackInputError,
    );
    // So is a rotated frame, and a frame outside its image.
    const changed = JSON.parse(readFileSync(join(dir, 'ui.json'), 'utf8')) as {
      frames: Record<string, { rotated: boolean; frame: { x: number } }>;
    };
    const [firstFrame] = Object.values(changed.frames);
    ok(firstFrame !== undefined);
    firstFrame.rotated = true;
    writeFileSync(join(dir, 'rotated.json'), JSON.stringify(changed));
    const packOne = (input: string): unknown =>
      buildPack({ ...options, inputs: [join(dir, input)], out: join(dir, 'one.png'), name: 'one' });
    throws(() => packOne('rotated.json'), /rotated/);
    firstFrame.rotated = false;
    firstFrame.frame.x = 10_000;
    writeFileSync(join(dir, 'outside.json'), JSON.stringify(changed));
    throws(() => packOne('outside.json'), /outside its/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

void test('atlas packing', packsAtlases);
void test('atlas packing from files', packsAtlasFiles);
