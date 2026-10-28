import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { Locator, Page } from 'playwright-core';
import typia from 'typia';

import { checkedMeasurement, checkedRect, checkedSnapshot } from './browser-validation.js';
import type { Finding } from './inspect.js';
import { decodePng, encodePng } from './png.js';
import {
  createRaster,
  pixelDifference,
  rasterDifference,
  type Raster,
  type RasterDifference,
  type Rect,
} from './raster.js';

export {
  loadBrowserBaseline,
  saveBrowserBaseline,
  type BrowserBaselineLoadOptions,
  type BrowserBaselineSaveOptions,
} from './browser-baseline.js';

/** An explicitly named content item; all rectangles use viewport CSS pixels. */
export interface BrowserContent {
  readonly bounds: Rect;
  readonly text?: string;
  /** Actual text-node or glyph rectangles, not an inferred safe area. */
  readonly textBounds?: readonly Rect[];
}

/** Renderer-reported focus state; visible does not prove a painted indicator. */
export interface BrowserFocusState {
  readonly focused: boolean;
  readonly visible: boolean;
}

export interface BrowserMeasurement {
  readonly focus?: BrowserFocusState;
  readonly bounds: Rect;
  readonly contentBox?: Rect;
  readonly content?: Readonly<Record<string, BrowserContent>>;
}

export interface BrowserSnapshot {
  readonly measurement: BrowserMeasurement;
  /** The enclosing screenshot rectangle, in viewport CSS pixels at capture time. */
  readonly clip: Rect;
  readonly raster: Raster;
}

export interface BrowserRegionSource {
  /** Wait for application readiness and, when needed, scroll before an operation. */
  readonly prepare?: () => Promise<void>;
  readonly measure: () => Promise<BrowserMeasurement>;
}

export interface BrowserDomSource {
  readonly root: Locator;
  readonly contentBox?: Locator;
  readonly content?: Readonly<Record<string, Locator>>;
}

export interface BrowserTarget {
  measure(): Promise<BrowserMeasurement>;
  hover(): Promise<void>;
  /** Move to the freshly measured center and press the left mouse button. */
  press(): Promise<void>;
  /** Release the left mouse button at its current position. */
  release(): Promise<void>;
  click(): Promise<void>;
  capture(): Promise<BrowserSnapshot>;
}

export interface BrowserCheckOptions {
  readonly focus?: { readonly focused: boolean; readonly visible?: boolean };
  readonly reference?: BrowserSnapshot;
  /** All three tolerances must be supplied; the default is exact equality. */
  readonly pixels?: RasterDifference;
  readonly changedFrom?: BrowserSnapshot;
  readonly stableGeometry?: {
    readonly reference: BrowserMeasurement;
    readonly tolerance?: number;
  };
  readonly text?: Readonly<Record<string, string>>;
  readonly contentFits?: boolean;
}

export interface BrowserReport {
  readonly ok: boolean;
  readonly findings: readonly Finding[];
  readonly pixels?: RasterDifference;
  readonly change?: RasterDifference;
}

export interface BrowserArtifactInput {
  readonly actual: BrowserSnapshot;
  readonly reference?: BrowserSnapshot;
  readonly changedFrom?: BrowserSnapshot;
  readonly report: BrowserReport;
}

export interface BrowserArtifactPaths {
  readonly actual: string;
  readonly report: string;
  readonly expected?: string;
  readonly diff?: string;
  readonly previous?: string;
  readonly change?: string;
}

interface Viewport {
  readonly scrollX: number;
  readonly scrollY: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Binds caller-measured UI without depending on its renderer or application state.
 * Actions dispatch real input; consumers must assert its observed effect.
 *
 * @evidence docs/spec.md#browser-ui-verification Measures fresh CSS rectangles, sends pointer input, and captures CSS-scale pixels with scroll and geometry guards through the optional browser entry point.
 * @evidenceReview docs/spec.md#browser-ui-verification #9f7e47a Read the section against the fresh-measurement, real-input and capture guards, and checked Playwright screenshot clip coordinate handling in the installed implementation.
 * @evidence docs/spec.md#browser-engine-compatibility Uses the same page input and CSS-scale screenshot path for browser engines, checking viewport stability and decoded clip dimensions without renderer-specific state changes.
 * @evidenceReview docs/spec.md#browser-engine-compatibility #d7e3d78 Re-read the compatibility contract and shared capture/input path; checked that checkSnapshot still defaults to zero pixel tolerance and accepts only explicit thresholds, while the text-region allowance belongs to the consumer fixture.
 */
export function regionTarget(page: Page, source: BrowserRegionSource): BrowserTarget {
  const measure = async (): Promise<BrowserMeasurement> => {
    await source.prepare?.();
    return checkedMeasurement(await source.measure());
  };
  const center = async (): Promise<{ x: number; y: number }> => {
    const { bounds } = await measure();
    const viewport = await readViewport(page);
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    if (x < 0 || y < 0 || x >= viewport.width || y >= viewport.height) {
      throw new RangeError('Browser target center is outside the viewport; scroll it into view.');
    }
    return { x, y };
  };
  return {
    measure,
    async hover() {
      const { x, y } = await center();
      await page.mouse.move(x, y);
    },
    async press() {
      const { x, y } = await center();
      await page.mouse.move(x, y);
      await page.mouse.down();
    },
    async release() {
      await page.mouse.up();
    },
    async click() {
      const { x, y } = await center();
      await page.mouse.click(x, y);
    },
    async capture() {
      const measurement = await measure();
      const before = await readViewport(page);
      const { bounds } = measurement;
      const x = Math.floor(bounds.x + before.scrollX);
      const y = Math.floor(bounds.y + before.scrollY);
      const clip = {
        x,
        y,
        width: Math.ceil(bounds.x + before.scrollX + bounds.width) - x,
        height: Math.ceil(bounds.y + before.scrollY + bounds.height) - y,
      };
      if (x < 0 || y < 0) {
        throw new RangeError('Browser target extends before the document origin.');
      }
      // Full-page clips use document coordinates; ordinary screenshot clips use
      // viewport coordinates and silently truncate regions outside the viewport.
      const raster = decodePng(await page.screenshot({
        type: 'png',
        fullPage: true,
        clip,
        scale: 'css',
        caret: 'initial',
      }));
      const after = await readViewport(page);
      const measuredAfter = checkedMeasurement(await source.measure());
      if (!sameViewport(before, after) || !sameMeasurement(measurement, measuredAfter)) {
        throw new Error('Browser target or scroll changed during capture; wait for a stable render.');
      }
      if (raster.width !== clip.width || raster.height !== clip.height) {
        throw new Error('Browser screenshot was truncated or was not captured at CSS-pixel scale.');
      }
      return {
        measurement,
        clip: { ...clip, x: clip.x - before.scrollX, y: clip.y - before.scrollY },
        raster,
      };
    },
  };
}

/** Binds main-frame DOM elements, including their actual text-node rectangles. */
export function domTarget(page: Page, source: BrowserDomSource): BrowserTarget {
  const locators = [
    source.root,
    ...(source.contentBox ? [source.contentBox] : []),
    ...Object.values(source.content ?? {}),
  ];
  if (locators.some((locator) => locator.page() !== page)) {
    throw new TypeError('Every browser DOM locator must belong to the supplied page.');
  }
  return regionTarget(page, {
    prepare: () => source.root.scrollIntoViewIfNeeded(),
    async measure() {
      const root = await measureDom(source.root);
      const contentBox = source.contentBox === undefined
        ? undefined
        : (await measureDom(source.contentBox)).bounds;
      const entries: [string, BrowserContent][] = [];
      for (const [name, locator] of Object.entries(source.content ?? {})) {
        entries.push([name, await measureDom(locator)]);
      }
      return {
        bounds: root.bounds,
        focus: await source.root.evaluate((element) => ({
          focused: element.matches(':focus'),
          visible: element.matches(':focus-visible'),
        })),
        ...(contentBox === undefined ? {} : { contentBox }),
        ...(source.content === undefined ? {} : { content: Object.fromEntries(entries) }),
      };
    },
  });
}

/**
 * Checks observations against explicit, independent content and image contracts.
 *
 * @evidence docs/spec.md#browser-keyboard-focus Checks explicit focus observations without input, rejects missing instrumentation and contradictory expectations, and leaves painted-indicator proof to pixel checks.
 * @evidenceReview docs/spec.md#browser-keyboard-focus #cdf74d0 Read the focus contract and checked DOM pseudo-class observations, missing-state findings, contradiction validation, and the capture stability comparison; painted focus remains an independent pixel assertion.
 *
 * @evidence docs/spec.md#browser-ui-verification Returns error findings for missing content instrumentation, exact text mismatch, overflow, relative geometry drift, unexpected pixels and absent visible transitions.
 * @evidenceReview docs/spec.md#browser-ui-verification #9f7e47a Read the section against each finding branch, independent geometry and pixel references, premultiplied comparisons and configuration validation.
 */
export function checkSnapshot(
  actual: BrowserSnapshot,
  options: BrowserCheckOptions = {},
): BrowserReport {
  checkedSnapshot(actual);
  typia.assert<BrowserCheckOptions>(options);
  if (options.pixels !== undefined && options.reference === undefined) {
    throw new TypeError('Pixel tolerances require a reference snapshot.');
  }
  const thresholds = options.pixels ?? { mean: 0, p99: 0, max: 0 };
  for (const value of Object.values(thresholds)) {
    nonnegative(value, 'Pixel tolerance');
  }
  if (options.focus?.visible === true && !options.focus.focused) {
    throw new TypeError('Visible focus requires focused state.');
  }
  const findings: Finding[] = [];
  if (options.focus !== undefined) {
    const observed = actual.measurement.focus;
    if (observed === undefined) {
      findings.push(
        finding('browser.focus-missing', 'Focus assertions require explicit focus instrumentation.'),
      );
    } else if (observed.focused !== options.focus.focused ||
      (options.focus.visible !== undefined && observed.visible !== options.focus.visible)) {
      findings.push(
        finding('browser.focus', 'The target has unexpected focus state.', {
          actual: observed,
          expected: options.focus,
        }),
      );
    }
  }
  const pixels = options.reference === undefined
    ? undefined
    : comparePixels(actual, options.reference, findings, 'reference');
  if (pixels !== undefined && (['mean', 'p99', 'max'] as const).some(
    (key) => pixels[key] > thresholds[key],
  )) {
    findings.push(
      finding('browser.pixels', 'Rendered pixels differ from the reference.', {
        actual: pixels,
        tolerance: thresholds,
      }),
    );
  }
  const change = options.changedFrom === undefined
    ? undefined
    : comparePixels(actual, options.changedFrom, findings, 'changedFrom');
  if (change?.max === 0) {
    findings.push(
      finding('browser.pixels-unchanged', 'The interaction produced no visible pixel change.'),
    );
  }
  if (options.stableGeometry !== undefined) {
    const tolerance = options.stableGeometry.tolerance ?? 0;
    nonnegative(tolerance, 'Geometry tolerance');
    const reference = checkedMeasurement(options.stableGeometry.reference);
    if (!sameRelativeGeometry(actual.measurement, reference, tolerance)) {
      findings.push(
        finding('browser.geometry', 'Target size or target-relative content geometry changed.', {
          actual: actual.measurement,
          expected: reference,
          tolerance,
        }),
      );
    }
  }
  for (const [name, expected] of Object.entries(options.text ?? {})) {
    const observed = ownContent(actual.measurement, name)?.text;
    if (observed !== expected) {
      findings.push(
        finding('browser.text', `Content ${name} has unexpected text.`, {
          name,
          actual: observed ?? null,
          expected,
        }),
      );
    }
  }
  if (options.contentFits === true) {
    checkContentFit(actual.measurement, findings);
  }
  return {
    ok: findings.length === 0,
    findings,
    ...(pixels === undefined ? {} : { pixels }),
    ...(change === undefined ? {} : { change }),
  };
}

/**
 * Writes review artifacts only; never approves or changes a reference snapshot.
 * Give each check its own output directory. Returned paths can be attached to
 * an existing runner's report.
 *
 * @evidence docs/spec.md#browser-ui-verification Saves actual, expected or previous, difference PNGs and a JSON report with measurements without updating a baseline.
 * @evidenceReview docs/spec.md#browser-ui-verification #9f7e47a Read the artifact-writing code against the section and checked that it serializes measurement metadata separately from raster bytes and never changes reference objects.
 */
export async function writeBrowserArtifacts(
  directory: string,
  input: BrowserArtifactInput,
): Promise<BrowserArtifactPaths> {
  checkedSnapshot(input.actual);
  if (input.reference !== undefined) {
    checkedSnapshot(input.reference);
  }
  if (input.changedFrom !== undefined) {
    checkedSnapshot(input.changedFrom);
  }
  const output = resolve(directory);
  await mkdir(output, { recursive: true });
  const paths: BrowserArtifactPaths = {
    actual: join(output, 'actual.png'),
    report: join(output, 'report.json'),
    ...(input.reference === undefined ? {} : {
      expected: join(output, 'expected.png'), diff: join(output, 'diff.png'),
    }),
    ...(input.changedFrom === undefined ? {} : {
      previous: join(output, 'previous.png'), change: join(output, 'change.png'),
    }),
  };
  await writeFile(paths.actual, encodePng(input.actual.raster));
  for (const [reference, imagePath, diffPath, staleNames] of [
    [input.reference, paths.expected, paths.diff, ['expected.png', 'diff.png']],
    [input.changedFrom, paths.previous, paths.change, ['previous.png', 'change.png']],
  ] as const) {
    if (reference !== undefined && imagePath !== undefined && diffPath !== undefined) {
      await writeFile(imagePath, encodePng(reference.raster));
      await writeFile(diffPath, encodePng(differenceRaster(input.actual.raster, reference.raster)));
    } else {
      for (const name of staleNames) {
        await rm(join(output, name), { force: true });
      }
    }
  }
  await writeFile(paths.report, `${JSON.stringify({
    ...input.report,
    actual: snapshotMetadata(input.actual),
    ...(input.reference === undefined ? {} : { reference: snapshotMetadata(input.reference) }),
    ...(input.changedFrom === undefined ? {} : { changedFrom: snapshotMetadata(input.changedFrom) }),
    artifacts: paths,
  }, null, 2)}\n`);
  return paths;
}

async function measureDom(locator: Locator): Promise<BrowserContent> {
  return locator.evaluate((element) => {
    const document = element.ownerDocument;
    if (document.defaultView !== document.defaultView?.top) {
      throw new TypeError('Browser DOM bindings require main-frame locators; use regionTarget for frames.');
    }
    const style = document.defaultView?.getComputedStyle(element);
    if (element.getClientRects().length === 0 || style?.visibility === 'hidden' ||
      style?.visibility === 'collapse') {
      throw new Error('Browser DOM bindings require visible elements.');
    }
    const rect = (value: Rect): Rect => ({
      x: value.x, y: value.y, width: value.width, height: value.height,
    });
    const textBounds: Rect[] = [];
    const walker = document.createTreeWalker(element, 4);
    let node = walker.nextNode();
    while (node !== null) {
      if ((node.textContent ?? '').trim().length > 0) {
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const value of range.getClientRects()) {
          textBounds.push(rect(value));
        }
      }
      node = walker.nextNode();
    }
    return { bounds: rect(element.getBoundingClientRect()), text: element.textContent ?? '', textBounds };
  });
}

async function readViewport(page: Page): Promise<Viewport> {
  const viewport = await page.evaluate(() => {
    const view = globalThis as unknown as {
      scrollX: number; scrollY: number; innerWidth: number; innerHeight: number;
    };
    return { scrollX: view.scrollX, scrollY: view.scrollY, width: view.innerWidth, height: view.innerHeight };
  });
  typia.assert<Viewport>(viewport);
  for (const value of Object.values(viewport)) {
    if (!Number.isFinite(value)) {
      throw new RangeError('Browser viewport measurements must be finite.');
    }
  }
  if (viewport.width <= 0 || viewport.height <= 0) {
    throw new RangeError('Browser viewport must have positive dimensions.');
  }
  return viewport;
}

function nonnegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be finite and nonnegative.`);
  }
}

function sameViewport(a: Viewport, b: Viewport): boolean {
  return a.scrollX === b.scrollX && a.scrollY === b.scrollY &&
    a.width === b.width && a.height === b.height;
}

function nearRect(a: Rect, b: Rect, tolerance: number): boolean {
  return (['x', 'y', 'width', 'height'] as const).every(
    (key) => Math.abs(a[key] - b[key]) <= tolerance,
  );
}

function relative(rect: Rect, bounds: Rect): Rect {
  return { ...rect, x: rect.x - bounds.x, y: rect.y - bounds.y };
}

function sameRelativeGeometry(a: BrowserMeasurement, b: BrowserMeasurement, tolerance: number): boolean {
  if (Math.abs(a.bounds.width - b.bounds.width) > tolerance ||
    Math.abs(a.bounds.height - b.bounds.height) > tolerance) {
    return false;
  }
  const same = (left: Rect | undefined, right: Rect | undefined): boolean =>
    left === undefined || right === undefined
      ? left === right
      : nearRect(relative(left, a.bounds), relative(right, b.bounds), tolerance);
  if (!same(a.contentBox, b.contentBox)) {
    return false;
  }
  const names = Object.keys(a.content ?? {}).sort();
  const otherNames = Object.keys(b.content ?? {}).sort();
  if (names.length !== otherNames.length || names.some((name, index) => name !== otherNames[index])) {
    return false;
  }
  return names.every((name) => {
    const left = ownContent(a, name);
    const right = ownContent(b, name);
    if (left === undefined || right === undefined || !same(left.bounds, right.bounds)) {
      return false;
    }
    const leftText = left.textBounds;
    const rightText = right.textBounds;
    if (leftText === undefined || rightText === undefined) {
      return leftText === rightText;
    }
    return leftText.length === rightText.length &&
      leftText.every((rect, index) => same(rect, rightText[index]));
  });
}

function sameMeasurement(a: BrowserMeasurement, b: BrowserMeasurement): boolean {
  return a.focus?.focused === b.focus?.focused && a.focus?.visible === b.focus?.visible &&
    nearRect(a.bounds, b.bounds, 0) && sameRelativeGeometry(a, b, 0) &&
    Object.entries(a.content ?? {}).every(([name, content]) => content.text === ownContent(b, name)?.text);
}

function ownContent(measurement: BrowserMeasurement, name: string): BrowserContent | undefined {
  return measurement.content !== undefined && Object.hasOwn(measurement.content, name)
    ? measurement.content[name]
    : undefined;
}

function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height;
}

function checkContentFit(measurement: BrowserMeasurement, findings: Finding[]): void {
  const { bounds, contentBox, content } = measurement;
  if (contentBox === undefined || Object.keys(content ?? {}).length === 0) {
    findings.push(
      finding(
        'browser.content-missing',
        'Content fit requires an explicit content box and named content.',
      ),
    );
    return;
  }
  if (!contains(bounds, contentBox)) {
    findings.push(
      finding('browser.content-overflow', 'The content box exceeds the target.', {
        bounds,
        contentBox,
      }),
    );
  }
  for (const [name, item] of Object.entries(content ?? {})) {
    if (!contains(contentBox, item.bounds) || (item.textBounds ?? []).some(
      (text) => !contains(contentBox, text) || !contains(item.bounds, text),
    )) {
      findings.push(
        finding('browser.content-overflow', `Content ${name} exceeds its declared region.`, {
          name,
          contentBox,
          content: item,
        }),
      );
    }
  }
}

function comparePixels(
  actual: BrowserSnapshot,
  reference: BrowserSnapshot,
  findings: Finding[],
  comparison: string,
): RasterDifference | undefined {
  checkedSnapshot(reference);
  if (actual.raster.width !== reference.raster.width || actual.raster.height !== reference.raster.height) {
    findings.push(
      finding('browser.pixel-size', 'Pixel comparison requires equal raster dimensions.', {
        comparison,
        actual: { width: actual.raster.width, height: actual.raster.height },
        expected: { width: reference.raster.width, height: reference.raster.height },
      }),
    );
    return undefined;
  }
  return rasterDifference(actual.raster, reference.raster);
}

function finding(code: string, message: string, details?: Readonly<Record<string, unknown>>): Finding {
  return { code, severity: 'error', message, ...(details === undefined ? {} : { details }) };
}

function snapshotMetadata(snapshot: BrowserSnapshot): object {
  return {
    measurement: snapshot.measurement,
    clip: snapshot.clip,
    width: snapshot.raster.width,
    height: snapshot.raster.height,
  };
}

function differenceRaster(actual: Raster, reference: Raster): Raster {
  const result = createRaster(
    Math.max(actual.width, reference.width),
    Math.max(actual.height, reference.height),
  );
  const pair = createRaster(2, 1);
  for (let y = 0; y < result.height; y += 1) {
    for (let x = 0; x < result.width; x += 1) {
      const at = (y * result.width + x) * 4;
      if (x >= actual.width || y >= actual.height || x >= reference.width || y >= reference.height) {
        result.data.set([255, 0, 255, 255], at);
      } else {
        const a = (y * actual.width + x) * 4;
        const b = (y * reference.width + x) * 4;
        pair.data.set(actual.data.subarray(a, a + 4), 0);
        pair.data.set(reference.data.subarray(b, b + 4), 4);
        const difference = Math.ceil(pixelDifference(pair, 0, 4));
        result.data.set([difference, 0, difference, 255], at);
      }
    }
  }
  return result;
}
