import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import typia from 'typia';

import { checkedMeasurement, checkedRect, checkedSnapshot } from './browser-validation.js';
import type { BrowserMeasurement, BrowserSnapshot } from './browser.js';
import { decodePng, encodePng } from './png.js';
import type { Raster, Rect } from './raster.js';

export interface BrowserBaselineSaveOptions {
  readonly approved: true;
  /** A caller-owned key for the browser, platform, fonts, and rendering setup. */
  readonly environment: string;
}

export interface BrowserBaselineLoadOptions {
  /** Must exactly match the key used when approving this baseline. */
  readonly environment: string;
}

interface BrowserBaselineManifest {
  readonly format: 'slicewright/browser-baseline';
  readonly version: 1;
  readonly environment: string;
  readonly measurement: BrowserMeasurement;
  readonly clip: Rect;
  readonly width: number;
  readonly height: number;
  readonly pngSha256: string;
}

/**
 * Persists an explicitly approved snapshot. The manifest is the commit point;
 * previous content-addressed images remain available to concurrent readers.
 *
 * @evidence docs/spec.md#persistent-browser-baselines Validates and serializes before writes, atomically installs complete immutable PNGs, and commits a versioned manifest last without implicit approval.
 * @evidenceReview docs/spec.md#persistent-browser-baselines #2479944 Read the section and Windows CI EPERM log; inspected approval guards, immutable image staging, bounded Windows sharing-error retries, atomic metadata replacement, and cleanup without deleting the destination.
 */
export async function saveBrowserBaseline(
  path: string,
  snapshot: BrowserSnapshot,
  options: BrowserBaselineSaveOptions,
): Promise<void> {
  if (options?.approved !== true) {
    throw new TypeError('Saving a browser baseline requires explicit approved: true.');
  }
  const environment = checkedEnvironment(options.environment);
  const manifestPath = checkedPath(path);
  checkedSnapshot(snapshot);
  const png = encodePng(snapshot.raster);
  const manifest: BrowserBaselineManifest = {
    format: 'slicewright/browser-baseline',
    version: 1,
    environment,
    measurement: checkedMeasurement(snapshot.measurement),
    clip: structuredClone(snapshot.clip),
    width: snapshot.raster.width,
    height: snapshot.raster.height,
    pngSha256: digest(png),
  };
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  // Validate the serialized representation as well: extra properties or
  // custom JSON values must never produce a file that our loader rejects.
  checkedManifest(JSON.parse(json));
  const pngPath = imagePath(manifestPath, manifest.pngSha256);
  const temporary = `${manifestPath}.${randomUUID()}`;
  const temporaryPng = `${temporary}.png.tmp`;
  const temporaryManifest = `${temporary}.json.tmp`;
  await mkdir(dirname(manifestPath), { recursive: true });
  try {
    await writeFile(temporaryPng, png, { flag: 'wx' });
    try {
      // Unlike writing the final file with 'wx', a hard link exposes only the
      // already complete file. Another approval may install this same image.
      await link(temporaryPng, pngPath);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
        throw error;
      }
      const existing = await readFile(pngPath);
      if (digest(existing) !== manifest.pngSha256) {
        throw new Error(`Existing browser baseline PNG has a digest mismatch: ${pngPath}`);
      }
    }
    await writeFile(temporaryManifest, json, { flag: 'wx' });
    await replaceManifest(temporaryManifest, manifestPath);
  } finally {
    await Promise.all([rm(temporaryPng, { force: true }), rm(temporaryManifest, { force: true })]);
  }
}

async function replaceManifest(source: string, destination: string): Promise<void> {
  // Windows can temporarily deny replacement while a reader holds the old
  // manifest open. Retry the rename itself; never remove the live baseline.
  const deadline = performance.now() + 2_000;
  let waitMs = 10;
  for (;;) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      const remaining = deadline - performance.now();
      if (process.platform !== 'win32' || remaining <= 0 ||
        (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY')) {
        throw error;
      }
      await delay(Math.min(waitMs, remaining));
      waitMs = Math.min(waitMs * 2, 100);
    }
  }
}

/**
 * Loads a validated snapshot for the caller's explicit rendering environment.
 * Loading never writes files or approves a missing reference.
 *
 * @evidence docs/spec.md#persistent-browser-baselines Validates the manifest with typia, rejects incompatible environments and corrupt images, and checks decoded raster dimensions against the saved measurement metadata.
 * @evidenceReview docs/spec.md#persistent-browser-baselines #2479944 Read the section and inspected typia, environment, path, digest, PNG, and dimension validation; checked the full pnpm test log with all five baseline groups passing.
 */
export async function loadBrowserBaseline(
  path: string,
  options: BrowserBaselineLoadOptions,
): Promise<BrowserSnapshot> {
  const environment = checkedEnvironment(options?.environment);
  const manifestPath = checkedPath(path);
  let manifest: BrowserBaselineManifest;
  try {
    manifest = checkedManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  } catch (error) {
    throw new Error(`Cannot load browser baseline manifest ${manifestPath}: ${message(error)}`, {
      cause: error,
    });
  }
  if (manifest.environment !== environment) {
    throw new Error(
      `Browser baseline environment mismatch: expected ${JSON.stringify(environment)}, ` +
        `received ${JSON.stringify(manifest.environment)}.`,
    );
  }
  const pngPath = imagePath(manifestPath, manifest.pngSha256);
  let png: Uint8Array;
  try {
    png = await readFile(pngPath);
  } catch (error) {
    throw new Error(`Cannot load browser baseline PNG ${pngPath}: ${message(error)}`, {
      cause: error,
    });
  }
  if (digest(png) !== manifest.pngSha256) {
    throw new Error(`Browser baseline PNG has a digest mismatch: ${pngPath}`);
  }
  let raster: Raster;
  try {
    raster = decodePng(png);
  } catch (error) {
    throw new Error(`Invalid browser baseline PNG ${pngPath}: ${message(error)}`, { cause: error });
  }
  if (raster.width !== manifest.width || raster.height !== manifest.height) {
    throw new RangeError('Browser baseline PNG dimensions do not match its manifest.');
  }
  const snapshot: BrowserSnapshot = {
    measurement: manifest.measurement,
    clip: manifest.clip,
    raster,
  };
  checkedSnapshot(snapshot);
  return snapshot;
}

function checkedManifest(value: unknown): BrowserBaselineManifest {
  const manifest = typia.assert<BrowserBaselineManifest>(value);
  checkedEnvironment(manifest.environment);
  checkedMeasurement(manifest.measurement);
  checkedRect(manifest.clip, 'Browser baseline clip', true);
  if (!/^[a-f0-9]{64}$/.test(manifest.pngSha256)) {
    throw new TypeError('Browser baseline PNG digest must be a lowercase SHA-256 hex string.');
  }
  const { width, height } = manifest;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
    !Number.isSafeInteger(width * height * 4) || width !== manifest.clip.width ||
    height !== manifest.clip.height) {
    throw new RangeError(
      'Browser baseline dimensions must be positive integers matching its clip.',
    );
  }
  return manifest;
}

function checkedEnvironment(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError('Browser baseline environment must be a nonempty string.');
  }
  return value;
}

function checkedPath(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\0')) {
    throw new TypeError('Browser baseline path must be a nonempty string without null bytes.');
  }
  return resolve(value);
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function imagePath(manifestPath: string, sha256: string): string {
  return `${manifestPath}.${sha256}.png`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
