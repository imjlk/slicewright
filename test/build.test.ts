import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import { buildInputs, BuildManifestError, readBuildManifest, runBuild } from '../src/build.js';
import { encodePng } from '../src/png.js';
import { watchTargets } from '../src/watch.js';
import { panel, shadedBar } from './fixtures.js';

/**
 * @evidence docs/spec.md#build-manifest Builds a dialog and a bar from a manifest into pieces, exports, and one packed atlas, skips packing when a piece fails, and refuses manifests the shape or the rules reject.
 * @evidenceReview docs/spec.md#build-manifest #81ef4f6 Checked the assertions against the section's validation, path, piece, failure, and watch-input rules and ran this test green with pnpm test.
 */
export function buildsManifests(): void {
  const dir = mkdtempSync(join(tmpdir(), 'slicewright-build-한글 경로-'));
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

    // A target's own files are planned too: a Godot .tres named like the pack image clashes.
    throws(
      () =>
        runBuild(
          readBuildManifest({
            out: 'tres/x.tres',
            piecesDir: 'tres',
            pieces: [{ input: 'bar.png', name: 'x', targets: ['godot'] }],
          }),
          dir,
          dir,
        ),
      BuildManifestError,
    );
    ok(!existsSync(join(dir, 'tres')));
    // Listing a target twice is still one file.
    const twice = runBuild(
      readBuildManifest({
        out: 'twice/ui.png',
        pieces: [{ input: 'bar.png', targets: ['godot', 'godot', 'unity'] }],
      }),
      dir,
      dir,
    );
    ok(twice.files.includes(join(dir, 'twice/pieces/bar.tres')));

    // A NUL in a name or path is refused before anything is written.
    throws(
      () => readBuildManifest({ out: 'ui.png', pieces: [{ input: 'bar.png', name: 'b\0' }] }),
      BuildManifestError,
    );
    throws(
      () => readBuildManifest({ out: 'u\0i.png', pieces: [{ input: 'bar.png' }] }),
      BuildManifestError,
    );

    // Without stylesheets, an image named like one is not a clash.
    const plain = runBuild(
      readBuildManifest({
        out: 'plain/z.css',
        name: 'z',
        css: false,
        pieces: [{ input: 'bar.png' }],
      }),
      dir,
      dir,
    );
    ok(plain.files.includes(join(dir, 'plain/z.css')));

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
    // A new file under a directory alias is the same file as under its target.
    // A Windows junction exercises this without requiring symlink privileges.
    mkdirSync(join(dir, 'real'));
    symlinkSync(
      join(dir, 'real'),
      join(dir, 'link'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
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

    // An existing file where an output needs a directory is refused first.
    writeFileSync(join(dir, 'blocked'), 'not a directory');
    throws(
      () =>
        runBuild(
          readBuildManifest({
            out: 'blocked/ui.png',
            piecesDir: 'blocked-parts',
            pieces: [{ input: 'bar.png', name: 'ui' }],
          }),
          dir,
          dir,
        ),
      /needs .* to be a directory/,
    );
    ok(!existsSync(join(dir, 'blocked-parts')));
    // A hard link to an input is the same file under another real path.
    mkdirSync(join(dir, 'hard'));
    linkSync(join(dir, 'bar.png'), join(dir, 'hard/bar.png'));
    throws(
      () =>
        runBuild(
          readBuildManifest({
            out: 'hard-pack/ui.png',
            piecesDir: 'hard',
            pieces: [{ input: 'bar.png' }],
          }),
          dir,
          dir,
        ),
      /write over its input/,
    );
    ok(!existsSync(join(dir, 'hard-pack')));

    // Stylesheet collisions fail the pack and are reported with it. Both names
    // are valid Windows filenames but become the same CSS class.
    const clashing = runBuild(
      readBuildManifest({
        out: 'css/ui.png',
        css: true,
        pieces: [
          { input: 'dialog-raw.png', name: 'a#b', width: 40 },
          { input: 'dialog-raw.png', name: 'a@b', width: 40 },
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

/**
 * @evidence docs/spec.md#build-groups Validates group membership, compares grouped states after normalizing, applies shared insets, refuses resized members with shared insets, and fails the build without packing on a mismatch.
 * @evidenceReview docs/spec.md#build-groups #5024de0 Checked the assertions against the section and ran this test green with pnpm test.
 */
export function buildsGroups(): void {
  const dir = mkdtempSync(join(tmpdir(), 'slicewright-build-groups-'));
  try {
    writeFileSync(join(dir, 'normal.png'), encodePng(panel(40, 30)));
    writeFileSync(join(dir, 'hover.png'), encodePng(panel(40, 30)));
    writeFileSync(join(dir, 'wide.png'), encodePng(panel(44, 30)));
    const pieces = [{ input: 'normal.png' }, { input: 'hover.png' }, { input: 'wide.png' }];
    const shared = runBuild(
      readBuildManifest({
        out: 'out/ui.png',
        pieces,
        groups: [{ name: 'button', pieces: ['normal', 'hover'], sharedInsets: true }],
      }),
      dir,
      dir,
    );
    ok(shared.ok);
    strictEqual(shared.groups[0]?.applied, true);
    deepStrictEqual(shared.groups[0]?.sharedInsets, { left: 6, right: 6, top: 6, bottom: 6 });
    deepStrictEqual(shared.pieces[0]?.insets, { left: 6, right: 6, top: 6, bottom: 6 });
    ok(shared.pack !== null);

    const mismatch = runBuild(
      readBuildManifest({
        out: 'out2/ui.png',
        pieces,
        groups: [{ name: 'button', pieces: ['normal', 'wide'] }],
      }),
      dir,
      dir,
    );
    strictEqual(mismatch.ok, false);
    strictEqual(mismatch.pack, null);
    strictEqual(mismatch.groups[0]?.ok, false);
    ok(mismatch.groups[0]?.findings.some((finding) => finding.code === 'compare.size'));

    const kept = runBuild(
      readBuildManifest({
        out: 'out4/ui.png',
        pieces: [
          { input: 'normal.png', keep: 1 },
          { input: 'hover.png', keep: 1 },
        ],
        groups: [{ name: 'button', pieces: ['normal', 'hover'], sharedInsets: true }],
      }),
      dir,
      dir,
    );
    ok(kept.ok);
    deepStrictEqual(kept.groups[0]?.sharedInsets, { left: 6, right: 6, top: 6, bottom: 6 });

    const layout = runBuild(
      readBuildManifest({
        out: 'out3/ui.png',
        pieces: [
          { input: 'normal.png', mode: 'nine' },
          { input: 'hover.png', mode: 'three' },
        ],
        groups: [{ name: 'button', pieces: ['normal', 'hover'] }],
      }),
      dir,
      dir,
    );
    strictEqual(layout.ok, false);
    ok(layout.groups[0]?.findings.some((finding) => finding.code === 'build.group-layout'));

    const manifest = (groups: unknown, extra: object = {}): unknown => ({
      out: 'out3/ui.png',
      pieces: [{ input: 'normal.png', ...extra }, { input: 'hover.png' }],
      groups,
    });
    throws(
      () => readBuildManifest(manifest([{ name: 'g', pieces: ['normal', 'nope'] }])),
      /unknown piece "nope"/,
    );
    throws(
      () =>
        readBuildManifest(
          manifest([
            { name: 'g', pieces: ['normal', 'hover'] },
            { name: 'h', pieces: ['normal', 'hover'] },
          ]),
        ),
      /belongs to one group/,
    );
    throws(
      () =>
        readBuildManifest(manifest([{ name: 'g', pieces: ['normal', 'hover'] }], { insets: '4' })),
      /gives insets or padding/,
    );
    throws(() => readBuildManifest(manifest([{ name: 'g', pieces: ['normal'] }])));
    throws(
      () =>
        readBuildManifest(
          manifest([{ name: 'g', pieces: ['normal', 'hover'], sharedInsets: true }], { scale: 2 }),
        ),
      /scale or a size/,
    );
    throws(
      () =>
        readBuildManifest(
          manifest([{ name: 'g', pieces: ['normal', 'hover'], sharedInsets: true }], { width: 80 }),
        ),
      /scale or a size/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * File symlinks need privileges on Windows, so they get their own test with an explicit skip.
 *
 * @evidence docs/spec.md#build-manifest Refuses a piece written through a dangling symlink onto the packed image, and watches where dangling input links will point; skips only when Windows denies creating the link.
 * @evidenceReview docs/spec.md#build-manifest #81ef4f6 Read the dangling-link rules in the section against realPath and watchTargets and ran this test green with pnpm test.
 */
export function followsDanglingSymlinks(context: TestContext): void {
  const dir = mkdtempSync(join(tmpdir(), 'slicewright-build-link-'));
  try {
    writeFileSync(join(dir, 'bar.png'), encodePng(shadedBar(48, 16)));
    mkdirSync(join(dir, 'parts'));
    try {
      symlinkSync(join(dir, 'out', 'ui.png'), join(dir, 'parts', 'bar.png'), 'file');
    } catch (error) {
      if (
        process.platform === 'win32' &&
        error instanceof Error &&
        'code' in error &&
        error.code === 'EPERM'
      ) {
        context.skip('File symlinks require Windows Developer Mode or symlink privileges.');
        return;
      }
      throw error;
    }
    throws(
      () =>
        runBuild(
          readBuildManifest({
            out: 'out/ui.png',
            piecesDir: 'parts',
            pieces: [{ input: 'bar.png' }],
          }),
          dir,
          dir,
        ),
      /Two build outputs/,
    );
    ok(!existsSync(join(dir, 'out')));
    // A dangling input link is watched where it will point.
    symlinkSync(join(dir, 'later', 'art.png'), join(dir, 'art.png'), 'file');
    ok(watchTargets([join(dir, 'art.png')]).has(join(dir, 'later', 'art.png')));
    // So is an input under a dangling directory link.
    symlinkSync(join(dir, 'moved'), join(dir, 'gone'), 'junction');
    ok(watchTargets([join(dir, 'gone', 'art.png')]).has(join(dir, 'moved', 'art.png')));
    if (process.platform !== 'win32') {
      // An output whose parent link leads through a file fails before any write.
      writeFileSync(join(dir, 'blocked'), '');
      symlinkSync(join(dir, 'blocked', 'child'), join(dir, 'through'), 'dir');
      throws(
        () =>
          runBuild(
            readBuildManifest({ out: 'through/ui.png', pieces: [{ input: 'bar.png' }] }),
            dir,
            dir,
          ),
        /to be a directory/,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

void test('build manifest', buildsManifests);
void test('build groups', buildsGroups);
void test('build follows dangling symlinks', followsDanglingSymlinks);
