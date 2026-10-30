import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  checkSnapshot,
  loadBrowserBaseline,
  saveBrowserBaseline,
  type BrowserBaselineSaveOptions,
  type BrowserMeasurement,
  type BrowserSnapshot,
} from '../src/browser.js';
import { encodePng } from '../src/png.js';
import { createRaster, type Rect } from '../src/raster.js';

const environment = 'test-platform-chromium-1248-viewport320-dpr2-fonts-v1';
const approval = { approved: true, environment } as const;

interface SavedManifest {
  format: string;
  version: number;
  environment: string;
  measurement: BrowserMeasurement;
  clip: Rect;
  width: number;
  height: number;
  pngSha256: string;
}

function snapshot(red = 30): BrowserSnapshot {
  const measurement: BrowserMeasurement = {
    bounds: { x: 10.25, y: 20.5, width: 7.5, height: 5.25 },
    contentBox: { x: 11, y: 21, width: 6, height: 4 },
    content: {
      label: {
        bounds: { x: 12, y: 22, width: 4, height: 2 },
        text: `Ready ${red}\n준비`,
        textBounds: [{ x: 12, y: 22, width: 3.5, height: 1.25 }],
      },
    },
  };
  const raster = createRaster(8, 6);
  for (let at = 0; at < raster.data.length; at += 4) {
    raster.data.set([red, 90, 120, at % 12 === 0 ? 77 : 255], at);
  }
  raster.data[7] = 0;
  return { measurement, clip: { x: 10, y: 20, width: 8, height: 6 }, raster };
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function imagePath(path: string, bytes: Uint8Array): string {
  return `${path}.${digest(bytes)}.png`;
}

async function readManifest(path: string): Promise<SavedManifest> {
  return JSON.parse(await readFile(path, 'utf8')) as SavedManifest;
}

async function noTemporaryFiles(directory: string): Promise<void> {
  deepStrictEqual(
    (await readdir(directory)).filter((name) => name.endsWith('.tmp')),
    [],
  );
}

/**
 * @evidence docs/spec.md#persistent-browser-baselines Exercises public save/load round-trips, exact environment keys, explicit replacement, retained images, and serialization before the first asynchronous write.
 * @evidenceReview docs/spec.md#persistent-browser-baselines #2479944 Read the section and reviewed metadata and alpha round-trip, replacement, retained-image, extra-property, and mutation assertions; checked this group's passing result in the full pnpm test log.
 */
export async function roundTripsBrowserBaselines(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'slicewright-baseline-'));
  const path = join(directory, 'panel.json');
  try {
    const original = {
      ...snapshot(),
      rendering: {
        viewport: { width:320, height:240 },
        deviceScaleFactor:2,
        runnerPlatform:'test',
        browser: { name:'chromium', version:'fixture' },
        labels:{ fontSet:'fixed' },
      },
      measurement: { ...snapshot().measurement, focus: { focused: true, visible: true } },
    };
    await saveBrowserBaseline(path, original, approval);
    deepStrictEqual(await loadBrowserBaseline(path, { environment }), original);
    ok(checkSnapshot(original, {
      reference: await loadBrowserBaseline(path, { environment }),
    }).ok);
    const manifest = await readManifest(path);
    strictEqual(manifest.format, 'slicewright/browser-baseline');
    strictEqual(manifest.version, 1);
    strictEqual(manifest.environment, environment);
    const originalImagePath = imagePath(path, encodePng(original.raster));
    const originalImage = await readFile(originalImagePath);

    const replacement = snapshot(80);
    await saveBrowserBaseline(path, replacement, approval);
    deepStrictEqual(await loadBrowserBaseline(path, { environment }), replacement);
    deepStrictEqual(await readFile(originalImagePath), originalImage);

    // Structural callers may carry additional serializable measurement data.
    // A successful save must produce a manifest the same loader accepts.
    const extra = {
      ...snapshot(110),
      measurement: { ...snapshot(110).measurement, note: 'consumer metadata' },
      clip: { ...snapshot(110).clip, note: 'extra clip property' },
    };
    await saveBrowserBaseline(path, extra, approval);
    deepStrictEqual(await loadBrowserBaseline(path, { environment }), extra);

    const mutable = snapshot(140);
    const expected = structuredClone(mutable);
    const saving = saveBrowserBaseline(path, mutable, approval);
    mutable.raster.data.fill(0);
    Object.assign(mutable.measurement.bounds, { x: 999 });
    Object.assign(mutable.measurement.content?.label ?? {}, { text: 'changed after save started' });
    await saving;
    deepStrictEqual(await loadBrowserBaseline(path, { environment }), expected);
    await noTemporaryFiles(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * @evidence docs/spec.md#persistent-browser-baselines Rejects invalid snapshots, environments, absent approval, and nonserializable metadata before creating directories or changing a previously approved baseline.
 * @evidenceReview docs/spec.md#persistent-browser-baselines #2479944 Read the section and reviewed invalid-input cases and assertions preserving original files and avoiding new directories; checked this group's passing result in the full pnpm test log.
 */
export async function rejectsInvalidBrowserBaselineWrites(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'slicewright-baseline-invalid-'));
  const path = join(directory, 'panel.json');
  try {
    const original = snapshot();
    await saveBrowserBaseline(path, original, approval);
    const originalManifest = await readFile(path);
    const originalPngPath = imagePath(path, encodePng(original.raster));
    const originalPng = await readFile(originalPngPath);
    const originalFiles = (await readdir(directory)).sort();
    const cyclic = snapshot();
    Object.assign(cyclic.measurement, { cycle: cyclic.measurement });
    const invalid: readonly [BrowserSnapshot, BrowserBaselineSaveOptions][] = [
      [original, undefined as unknown as BrowserBaselineSaveOptions],
      [original, { environment } as BrowserBaselineSaveOptions],
      [original, { approved: false, environment } as unknown as BrowserBaselineSaveOptions],
      [original, { ...approval, environment: '' }],
      [original, { ...approval, environment: ' \n\t' }],
      [{ ...original, clip: { ...original.clip, width: 0 } }, approval],
      [{ ...original, raster: { ...original.raster, data: new Uint8Array(1) } }, approval],
      [{ ...original, measurement: { bounds: { ...original.measurement.bounds, x: NaN } } }, approval],
      [{ ...original, clip: {
        ...original.clip,
        toJSON: () => ({ ...original.clip, width: 0 }),
      } } as BrowserSnapshot, approval],
      [cyclic, approval],
      [{ ...original, measurement: { ...original.measurement, extra: 1n } } as BrowserSnapshot, approval],
    ];
    for (const [index, [actual, options]] of invalid.entries()) {
      const fresh = join(directory, `uncreated-${index}`, 'panel.json');
      await rejects(saveBrowserBaseline(fresh, actual, options));
      await rejects(saveBrowserBaseline(path, actual, options));
      deepStrictEqual(await readFile(path), originalManifest);
      deepStrictEqual(await readFile(originalPngPath), originalPng);
      deepStrictEqual((await readdir(directory)).sort(), originalFiles);
      deepStrictEqual(await loadBrowserBaseline(path, { environment }), original);
    }
    await rejects(saveBrowserBaseline('', original, approval), /path must be a nonempty string/);
    await rejects(
      loadBrowserBaseline(join(directory, 'missing', 'panel.json'), { environment }),
      /ENOENT/,
    );
    await rejects(
      loadBrowserBaseline(path, { environment: 'other-platform' }),
      /environment mismatch/,
    );
    await rejects(
      loadBrowserBaseline(path, { environment: ' ' }),
      /environment must be a nonempty string/,
    );
    deepStrictEqual((await readdir(directory)).sort(), originalFiles);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * @evidence docs/spec.md#persistent-browser-baselines Rejects incompatible JSON, bad digests and environments, malformed measurements, missing or invalid PNGs, and decoded raster dimensions inconsistent with metadata.
 * @evidenceReview docs/spec.md#persistent-browser-baselines #2479944 Read the section and reviewed corrupt manifests and images, ignored JSON paths, dimension mismatches, and read-only loading; checked this group's passing result in the full pnpm test log.
 */
export async function rejectsCorruptBrowserBaselines(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'slicewright-baseline-corrupt-'));
  const path = join(directory, 'panel.json');
  try {
    const original = snapshot();
    await saveBrowserBaseline(path, original, approval);
    const manifest = await readManifest(path);
    const json = await readFile(path, 'utf8');
    const pngPath = imagePath(path, encodePng(original.raster));
    const png = await readFile(pngPath);
    const malformed = [
      '{',
      JSON.stringify(null),
      JSON.stringify({ ...manifest, format: 'another-tool' }),
      JSON.stringify({ ...manifest, version: 2 }),
      JSON.stringify({ ...manifest, environment: '' }),
      JSON.stringify({ ...manifest, pngSha256: '../outside.png' }),
      JSON.stringify({ ...manifest, pngSha256: 'A'.repeat(64) }),
      JSON.stringify({ ...manifest, width: 8.5 }),
      JSON.stringify({ ...manifest, clip: { ...manifest.clip, width: 7 } }),
      JSON.stringify({
        ...manifest,
        measurement: { bounds: { ...manifest.measurement.bounds, x: null } },
      }),
      JSON.stringify({
        ...manifest,
        measurement: { ...manifest.measurement, content: { label: { text: 'missing bounds' } } },
      }),
    ];
    for (const contents of malformed) {
      await writeFile(path, contents);
      await rejects(
        loadBrowserBaseline(path, { environment }),
        /Cannot load browser baseline manifest/,
      );
      strictEqual(
        await readFile(path, 'utf8'),
        contents,
        'Loading must not rewrite invalid metadata.',
      );
    }

    // JSON cannot redirect the loader to an arbitrary image path.
    await writeFile(path, JSON.stringify({ ...manifest, pngPath: '../outside.png' }));
    deepStrictEqual(await loadBrowserBaseline(path, { environment }), original);
    await writeFile(path, json);
    await rm(pngPath);
    await rejects(
      loadBrowserBaseline(path, { environment }),
      /Cannot load browser baseline PNG.*ENOENT/,
    );
    await writeFile(pngPath, 'damaged image');
    await rejects(loadBrowserBaseline(path, { environment }), /digest mismatch/);
    await writeFile(pngPath, png);

    const badPng = new TextEncoder().encode('not a PNG');
    await writeFile(imagePath(path, badPng), badPng);
    await writeFile(path, JSON.stringify({ ...manifest, pngSha256: digest(badPng) }));
    await rejects(loadBrowserBaseline(path, { environment }), /Invalid browser baseline PNG/);

    const differentlySizedPng = encodePng(createRaster(9, 6));
    await writeFile(imagePath(path, differentlySizedPng), differentlySizedPng);
    await writeFile(path, JSON.stringify({ ...manifest, pngSha256: digest(differentlySizedPng) }));
    await rejects(loadBrowserBaseline(path, { environment }), /PNG dimensions do not match/);
    await writeFile(path, json);
    deepStrictEqual(await loadBrowserBaseline(path, { environment }), original);
    await noTemporaryFiles(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * @evidence docs/spec.md#persistent-browser-baselines Forces image-install failures with corrupt existing digest contents and a directory collision, then verifies existing metadata and pixels remain unchanged and staging files are removed.
 * @evidenceReview docs/spec.md#persistent-browser-baselines #2479944 Read the section and reviewed deterministic image-install failures and preservation and cleanup assertions; checked this group's passing result in the full pnpm test log.
 */
export async function preservesBrowserBaselinesAfterInstallFailure(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'slicewright-baseline-preserved-'));
  const path = join(directory, 'panel.json');
  try {
    const original = snapshot();
    await saveBrowserBaseline(path, original, approval);
    const originalManifest = await readFile(path);
    const originalPngPath = imagePath(path, encodePng(original.raster));
    const originalPng = await readFile(originalPngPath);
    const replacement = snapshot(80);
    const blockedImagePath = imagePath(path, encodePng(replacement.raster));
    await writeFile(blockedImagePath, 'wrong bytes under the requested digest');
    await rejects(saveBrowserBaseline(path, replacement, approval), /digest mismatch/);
    deepStrictEqual(await readFile(path), originalManifest);
    deepStrictEqual(await loadBrowserBaseline(path, { environment }), original);
    await noTemporaryFiles(directory);

    await rm(blockedImagePath);
    await mkdir(blockedImagePath);
    await rejects(saveBrowserBaseline(path, replacement, approval));
    deepStrictEqual(await readFile(path), originalManifest);
    deepStrictEqual(await readFile(originalPngPath), originalPng);
    deepStrictEqual(await loadBrowserBaseline(path, { environment }), original);
    await noTemporaryFiles(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * @evidence docs/spec.md#persistent-browser-baselines Reads repeatedly while competing approved saves replace metadata and share immutable PNGs, requiring every observation to be one complete snapshot and retaining previous digest images.
 * @evidenceReview docs/spec.md#persistent-browser-baselines #2479944 Read the section and reviewed concurrent readers and writers, complete-snapshot equality, same-digest approvals, retained images, and cleanup; checked this group's passing result in the full pnpm test log.
 */
export async function readsBrowserBaselinesDuringApproval(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'slicewright-baseline-concurrent-'));
  const path = join(directory, 'panel.json');
  try {
    const first = snapshot();
    const second = snapshot(80);
    await saveBrowserBaseline(path, first, approval);
    const read = async (): Promise<void> => {
      for (let index = 0; index < 32; index += 1) {
        const actual = await loadBrowserBaseline(path, { environment });
        const expected = actual.measurement.content?.label?.text === first.measurement.content?.label?.text
          ? first
          : second;
        deepStrictEqual(actual, expected, 'A reader must see one complete old or new snapshot.');
      }
    };
    const save = async (offset: number): Promise<void> => {
      for (let index = 0; index < 12; index += 1) {
        await saveBrowserBaseline(path, (index + offset) % 2 === 0 ? first : second, approval);
      }
    };
    await Promise.all([read(), read(), save(0), save(1)]);
    await Promise.all([
      saveBrowserBaseline(path, second, approval),
      saveBrowserBaseline(path, second, approval),
    ]);
    deepStrictEqual(await loadBrowserBaseline(path, { environment }), second);
    for (const expected of [first, second]) {
      const png = encodePng(expected.raster);
      deepStrictEqual(new Uint8Array(await readFile(imagePath(path, png))), png);
    }
    await noTemporaryFiles(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

void test('browser baseline round-trip and explicit replacement', roundTripsBrowserBaselines);
void test('browser baseline rejection without writes', rejectsInvalidBrowserBaselineWrites);
void test('browser baseline corrupt and incompatible files', rejectsCorruptBrowserBaselines);
void test(
  'browser baseline preservation after image-install failure',
  preservesBrowserBaselinesAfterInstallFailure,
);
void test('browser baseline concurrent readers and approvals', readsBrowserBaselinesDuringApproval);
