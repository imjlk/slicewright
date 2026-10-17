import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { buildInputs, BuildManifestError, readBuildManifest, runBuild } from '../src/build.js';
import { encodePng } from '../src/png.js';
import { panel, shadedBar } from './fixtures.js';

/**
 * @evidence docs/spec.md#build-manifest Builds a dialog and a bar from a manifest into pieces, exports, and one packed atlas, skips packing when a piece fails, and refuses manifests the shape or the rules reject.
 * @evidenceReview docs/spec.md#build-manifest #6fca211 Checked the assertions against the section's validation, path, piece, failure, and watch-input rules and ran this test green with pnpm test.
 */
export function buildsManifests(): void {
  const dir = mkdtempSync(join(tmpdir(), 'slicewright-build-'));
  try {
    writeFileSync(join(dir, 'dialog-raw.png'), encodePng(panel(80, 60, 4)));
    writeFileSync(join(dir, 'bar.png'), encodePng(shadedBar(48, 12)));
    const manifest = readBuildManifest({
      out: 'out/ui.png',
      css: true,
      pieces: [
        { input: 'dialog-raw.png', name: 'dialog', width: 40, targets: ['css'] },
        { input: 'bar.png', mode: 'three' },
      ],
    });
    deepStrictEqual(buildInputs(manifest, join(dir, 'ui.build.json')), [
      join(dir, 'ui.build.json'),
      join(dir, 'dialog-raw.png'),
      join(dir, 'bar.png'),
    ]);

    const report = runBuild(manifest, dir, dir);
    strictEqual(report.ok, true);
    deepStrictEqual(
      report.pieces.map((piece) => [piece.name, piece.ok, piece.mode]),
      [
        ['dialog', true, 'nine'],
        ['bar', true, 'three'],
      ],
    );
    // The dialog was cropped, then resized to 40 px wide.
    deepStrictEqual(
      report.pieces[0]?.steps.map((step) => step.step),
      ['crop', 'resize'],
    );
    strictEqual(report.pieces[0]?.exports[0]?.target, 'css');
    for (const file of [
      'out/pieces/dialog.png',
      'out/pieces/dialog.json',
      'out/pieces/dialog.css',
      'out/pieces/bar.png',
      'out/pieces/bar.json',
      'out/ui.png',
      'out/ui.json',
      'out/ui.css',
    ]) {
      ok(existsSync(join(dir, file)), file);
    }
    deepStrictEqual(
      Object.keys(
        (JSON.parse(readFileSync(join(dir, 'out/ui.json'), 'utf8')) as { frames: object }).frames,
      ),
      ['dialog', 'bar'],
    );
    ok(report.pack?.usage.startsWith('this.load.atlas("ui", "out/ui.png", "out/ui.json");'));
    ok(report.files.includes(join(dir, 'out/ui.png')));

    // A piece whose given insets cut detail fails, and nothing is packed.
    const failing = runBuild(
      readBuildManifest({
        out: 'bad/ui.png',
        piecesDir: 'bad/parts',
        pieces: [{ input: 'dialog-raw.png', name: 'dialog', insets: '1' }],
      }),
      dir,
      dir,
    );
    strictEqual(failing.ok, false);
    strictEqual(failing.pack, null);
    ok(existsSync(join(dir, 'bad/parts/dialog.png')));
    ok(!existsSync(join(dir, 'bad/ui.png')));

    // Pieces normalized next to their sources would overwrite them.
    throws(
      () =>
        runBuild(
          readBuildManifest({ out: 'ui.png', piecesDir: '.', pieces: [{ input: 'bar.png' }] }),
          dir,
          dir,
        ),
      BuildManifestError,
    );

    // The manifest itself, and two outputs at one path, are refused too.
    throws(
      () =>
        runBuild(
          readBuildManifest({ out: 'ui.build.json', pieces: [{ input: 'bar.png' }] }),
          dir,
          dir,
          [join(dir, 'ui.build.json')],
        ),
      BuildManifestError,
    );
    throws(
      () =>
        runBuild(
          readBuildManifest({
            out: 'out/ui.png',
            piecesDir: 'out',
            pieces: [{ input: 'bar.png', name: 'ui' }],
          }),
          dir,
          dir,
        ),
      BuildManifestError,
    );

    // An output that would also have to be a directory is refused.
    throws(
      () =>
        runBuild(
          readBuildManifest({ out: 'parts', piecesDir: 'parts', pieces: [{ input: 'bar.png' }] }),
          dir,
          dir,
        ),
      BuildManifestError,
    );
    mkdirSync(join(dir, 'taken.png'));
    throws(
      () =>
        runBuild(readBuildManifest({ out: 'taken.png', pieces: [{ input: 'bar.png' }] }), dir, dir),
      BuildManifestError,
    );

    // A piece's stylesheet is planned too, so nothing is written before the refusal.
    throws(
      () =>
        runBuild(
          readBuildManifest({
            out: 'o/pack.png',
            piecesDir: 'parts',
            pieces: [{ input: 'bar.png', name: 'ui', targets: ['css'] }],
          }),
          dir,
          dir,
          [join(dir, 'parts/ui.css')],
        ),
      BuildManifestError,
    );
    ok(!existsSync(join(dir, 'parts/ui.png')));
    // A new file under a symlinked directory is the same file as under its target.
    mkdirSync(join(dir, 'real'));
    symlinkSync(join(dir, 'real'), join(dir, 'link'));
    throws(
      () =>
        runBuild(
          readBuildManifest({
            out: 'real/ui.png',
            piecesDir: 'link',
            pieces: [{ input: 'bar.png', name: 'ui' }],
          }),
          dir,
          dir,
        ),
      BuildManifestError,
    );
    ok(!existsSync(join(dir, 'real/ui.png')));

    // Stylesheet collisions fail the pack and are reported with it.
    const clashing = runBuild(
      readBuildManifest({
        out: 'css/ui.png',
        css: true,
        pieces: [
          { input: 'dialog-raw.png', name: 'a#b', width: 40 },
          { input: 'dialog-raw.png', name: 'a?b', width: 40 },
        ],
      }),
      dir,
      dir,
    );
    strictEqual(clashing.ok, false);
    ok(clashing.pack?.cssFindings.some((finding) => finding.code === 'pack.css-class-collision'));

    // Manifests the shape or the rules reject.
    throws(() => readBuildManifest({ out: 'ui.png', pieces: [] }));
    throws(() => readBuildManifest({ out: 'ui.png', pieces: [{ input: 'a.png', width: 0 }] }));
    throws(() => readBuildManifest({ out: 'ui.png', pieces: [{ input: 'a.png', extra: 1 }] }));
    for (const pieces of [
      [{ input: 'a.png' }, { input: 'other/A.png' }],
      [{ input: 'a.png', name: '../a' }],
      [{ input: 'a.png', scale: 2, width: 40 }],
      [{ input: 'a.png', regions: 'multi', insets: '6' }],
      [{ input: 'a.png', insets: '1,x' }],
      [{ input: 'a.png', targets: ['unity-ish'] }],
    ]) {
      throws(() => readBuildManifest({ out: 'ui.png', pieces }), BuildManifestError);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

void test('build manifest', buildsManifests);
