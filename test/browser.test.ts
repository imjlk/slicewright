import { deepStrictEqual, ok, rejects, strictEqual, throws } from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { Page } from 'playwright-core';

import {
  checkSnapshot,
  regionTarget,
  writeBrowserArtifacts,
  type BrowserMeasurement,
  type BrowserSnapshot,
} from '../src/browser.js';
import { decodePng, encodePng } from '../src/png.js';
import { createRaster, type Rect } from '../src/raster.js';

function measurement(): BrowserMeasurement {
  return {
    bounds: { x: 10, y: 20, width: 8, height: 6 },
    contentBox: { x: 11, y: 21, width: 6, height: 4 },
    content: {
      label: {
        bounds: { x: 12, y: 22, width: 4, height: 2 },
        text: 'Ready',
        textBounds: [{ x: 12, y: 22, width: 3, height: 2 }],
      },
    },
  };
}

function snapshot(observation = measurement(), red = 30): BrowserSnapshot {
  const raster = createRaster(observation.bounds.width, observation.bounds.height);
  for (let at = 0; at < raster.data.length; at += 4) {
    raster.data.set([red, 90, 120, 255], at);
  }
  return { measurement: observation, clip: observation.bounds, raster };
}

function codes(result: ReturnType<typeof checkSnapshot>): string[] {
  return result.findings.map(({ code }) => code);
}

function shifted(value: BrowserMeasurement, x: number, y: number): BrowserMeasurement {
  const move = (rect: Rect): Rect => ({ ...rect, x: rect.x + x, y: rect.y + y });
  return {
    bounds: move(value.bounds),
    ...(value.contentBox === undefined ? {} : { contentBox: move(value.contentBox) }),
    content: Object.fromEntries(
      Object.entries(value.content ?? {}).map(([name, content]) => [
        name,
        {
          ...content,
          bounds: move(content.bounds),
          ...(content.textBounds === undefined ? {} : { textBounds: content.textBounds.map(move) }),
        },
      ]),
    ),
  };
}

/**
 * @evidence docs/spec.md#browser-ui-verification Checks explicit content and glyph overflow, exact text, independent geometry and image references, real pixel-change requirements, malformed inputs, and dimensional mismatch findings.
 * @evidenceReview docs/spec.md#browser-ui-verification #9f7e47a Read the section and ran pnpm test: explicit fit, exact text, independent image and geometry references, transparency, size mismatch and malformed inputs passed.
 */
export function checksBrowserSnapshots(): void {
  const normal = snapshot();
  const hover = snapshot(measurement(), 80);
  ok(checkSnapshot(hover, {
    reference: hover,
    changedFrom: normal,
    stableGeometry: { reference: normal.measurement },
    contentFits: true,
    text: { label: 'Ready' },
  }).ok);
  deepStrictEqual(codes(checkSnapshot(normal, { changedFrom: normal })), [
    'browser.pixels-unchanged',
  ]);
  deepStrictEqual(codes(checkSnapshot(hover, { reference: normal })), ['browser.pixels']);
  ok(checkSnapshot(hover, { reference: normal, pixels: { mean: 50, p99: 50, max: 50 } }).ok);
  strictEqual(checkSnapshot(hover, { changedFrom: normal }).change?.max, 50);
  deepStrictEqual(
    codes(checkSnapshot(normal, { text: { label: 'Activated', missing: 'Ready' } })),
    ['browser.text', 'browser.text'],
  );
  ok(checkSnapshot(snapshot(shifted(normal.measurement, 30, -100)), {
    stableGeometry: { reference: normal.measurement },
    contentFits: true,
  }).ok, 'scrolling does not change target-relative geometry');

  const movedContent = measurement();
  const label = movedContent.content?.label;
  ok(label);
  const drift: BrowserMeasurement = {
    ...movedContent,
    content: { label: { ...label, bounds: { ...label.bounds, x: label.bounds.x + 0.5 } } },
  };
  deepStrictEqual(
    codes(
      checkSnapshot(snapshot(drift), {
        stableGeometry: { reference: normal.measurement },
      }),
    ),
    ['browser.geometry'],
  );
  ok(checkSnapshot(snapshot(drift), {
    stableGeometry: { reference: normal.measurement, tolerance: 0.5 },
  }).ok);
  const overflow: BrowserMeasurement = {
    ...movedContent,
    content: { label: { ...label, textBounds: [{ ...label.bounds, width: 5 }] } },
  };
  deepStrictEqual(codes(checkSnapshot(snapshot(overflow), { contentFits: true })), [
    'browser.content-overflow',
  ]);
  deepStrictEqual(
    codes(checkSnapshot(snapshot({ bounds: movedContent.bounds }), { contentFits: true })),
    ['browser.content-missing'],
  );
  deepStrictEqual(
    codes(checkSnapshot(snapshot({ ...movedContent, content: {} }), { contentFits: true })),
    ['browser.content-missing'],
  );
  const outerContent = snapshot({
    ...movedContent,
    contentBox: { ...movedContent.bounds, width: 9 },
  });
  ok(
    codes(checkSnapshot(outerContent, { contentFits: true })).includes('browser.content-overflow'),
  );

  const sized = snapshot({ bounds: { ...normal.measurement.bounds, width: 9 } });
  deepStrictEqual(codes(checkSnapshot(sized, { reference: normal, changedFrom: normal })), [
    'browser.pixel-size',
    'browser.pixel-size',
  ]);
  const transparentA = snapshot();
  const transparentB = snapshot();
  transparentA.raster.data.fill(0);
  transparentB.raster.data.fill(0);
  transparentB.raster.data[0] = 200;
  ok(checkSnapshot(transparentA, { reference: transparentB }).ok);
  deepStrictEqual(
    codes(checkSnapshot(transparentA, { changedFrom: transparentB })),
    ['browser.pixels-unchanged'],
    'hidden RGB changes are not visible changes',
  );
  throws(() => checkSnapshot(normal, { pixels: { mean: 1, p99: 1, max: 1 } }), /reference/);
  throws(
    () => checkSnapshot(normal, { reference: normal, pixels: { mean: -1, p99: 1, max: 1 } }),
    /nonnegative/,
  );
  throws(() =>
    checkSnapshot(normal, { stableGeometry: { reference: measurement(), tolerance: NaN } }),
  );
  throws(
    () => checkSnapshot({ ...normal, raster: { ...normal.raster, data: new Uint8Array(1) } }),
    /RGBA/,
  );
  throws(() =>
    checkSnapshot({
      ...normal,
      measurement: { bounds: { x: 0, y: 0, width: Infinity, height: 1 } },
    }),
  );
}

/**
 * @evidence docs/spec.md#browser-ui-verification Exercises fresh pointer coordinates, non-recentering release, scrolled fractional CSS captures, immutable observations, and rejection of offscreen, moving, invalid, or truncated targets through a recording Page double.
 * @evidenceReview docs/spec.md#browser-ui-verification #9f7e47a Read the section and ran pnpm test: fresh pointer coordinates, non-recentering release, scrolled CSS clips and capture rejection passed with a Page double; real delivery is covered by the packed browser consumer.
 */
export async function capturesBrowserTargets(): Promise<void> {
  const events: unknown[] = [];
  let current: BrowserMeasurement = { bounds: { x: 2.25, y: 10.25, width: 5.5, height: 4.5 } };
  let viewport = { scrollX: 10, scrollY: 200, width: 100, height: 100 };
  let onScreenshot = (): void => {};
  let screenshotWidth = 6;
  const page = {
    mouse: {
      async move(x: number, y: number) {
        events.push(['move', x, y]);
      },
      async down() {
        events.push(['down']);
      },
      async up() {
        events.push(['up']);
      },
      async click(x: number, y: number) {
        events.push(['click', x, y]);
      },
    },
    async evaluate() {
      return { ...viewport };
    },
    async screenshot(options: unknown) {
      events.push(['screenshot', options]);
      onScreenshot();
      return encodePng(createRaster(screenshotWidth, 5));
    },
  } as unknown as Page;
  const target = regionTarget(page, {
    async prepare() {
      events.push(['prepare']);
    },
    async measure() {
      return current;
    },
  });
  await target.hover();
  await target.press();
  current = { bounds: { ...current.bounds, x: 12.25 } };
  await target.release();
  await target.click();
  deepStrictEqual(events, [
    ['prepare'],
    ['move', 5, 12.5],
    ['prepare'],
    ['move', 5, 12.5],
    ['down'],
    ['up'],
    ['prepare'],
    ['click', 15, 12.5],
  ]);
  events.length = 0;
  const captured = await target.capture();
  deepStrictEqual(captured.clip, { x: 12, y: 10, width: 6, height: 5 });
  deepStrictEqual(events, [
    ['prepare'],
    [
      'screenshot',
      {
        type: 'png',
        fullPage: true,
        clip: { x: 22, y: 210, width: 6, height: 5 },
        scale: 'css',
        caret: 'initial',
      },
    ],
  ]);
  const original = structuredClone(current);
  const mutableBounds = current.bounds as { x: number };
  mutableBounds.x = 500;
  strictEqual(captured.measurement.bounds.x, 12.25);
  await rejects(target.click(), /outside the viewport/);
  current = original;
  onScreenshot = () => {
    current = { bounds: { ...current.bounds, y: 11.25 } };
  };
  await rejects(target.capture(), /changed during capture/);
  current = { ...original, focus: { focused: false, visible: false } };
  onScreenshot = () => {
    current = { ...original, focus: { focused: true, visible: true } };
  };
  await rejects(target.capture(), /changed during capture/);
  current = original;
  onScreenshot = () => {
    viewport = { ...viewport, scrollY: 201 };
  };
  await rejects(target.capture(), /changed during capture/);
  onScreenshot = () => {};
  screenshotWidth = 5;
  await rejects(target.capture(), /truncated/);
  current = { bounds: { x: -100, y: 10, width: 5, height: 4 } };
  await rejects(target.capture(), /document origin/);
  current = { bounds: { x: 0, y: 0, width: 0, height: 1 } };
  await rejects(target.measure(), /positive/);
  current = { bounds: { x: 0, y: 0, width: NaN, height: 1 } };
  await rejects(target.measure());
}

/**
 * @evidence docs/spec.md#browser-ui-verification Reads generated actual, expected, previous and difference PNGs and JSON measurements, including size mismatch evidence and removal of stale optional artifacts.
 * @evidenceReview docs/spec.md#browser-ui-verification #9f7e47a Read the section and ran pnpm test: PNG dimensions, JSON measurements, optional comparison artifacts and stale file removal passed.
 */
export async function writesBrowserFailureArtifacts(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'slicewright-browser-'));
  try {
    const actual = snapshot();
    const reference = snapshot({ bounds: { x: 0, y: 0, width: 9, height: 6 } });
    const report = checkSnapshot(actual, { reference, changedFrom: actual });
    const paths = await writeBrowserArtifacts(directory, {
      actual,
      reference,
      changedFrom: actual,
      report,
    });
    ok(paths.expected && paths.diff && paths.previous && paths.change);
    strictEqual(decodePng(await readFile(paths.actual)).width, 8);
    strictEqual(decodePng(await readFile(paths.expected)).width, 9);
    strictEqual(decodePng(await readFile(paths.diff)).width, 9);
    strictEqual(decodePng(await readFile(paths.previous)).width, 8);
    strictEqual(decodePng(await readFile(paths.change)).data[0], 0);
    const json = JSON.parse(await readFile(paths.report, 'utf8')) as {
      ok: boolean; actual: { measurement: BrowserMeasurement }; artifacts: { actual: string };
    };
    strictEqual(json.ok, false);
    deepStrictEqual(json.actual.measurement, actual.measurement);
    strictEqual(json.artifacts.actual, paths.actual);
    const onlyActual = await writeBrowserArtifacts(directory, {
      actual,
      report: checkSnapshot(actual),
    });
    strictEqual(onlyActual.expected, undefined);
    await rejects(readFile(paths.expected), { code: 'ENOENT' });
    await rejects(readFile(paths.change), { code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

void test('browser snapshot contracts', checksBrowserSnapshots);
void test('browser target measurement and capture guards', capturesBrowserTargets);
void test('browser failure artifacts', writesBrowserFailureArtifacts);

/**
 * @evidence docs/spec.md#browser-keyboard-focus Exercises unknown versus false focus, exact and visible expectations, logical focus without painting, geometry independence, and malformed or contradictory observations.
 * @evidenceReview docs/spec.md#browser-keyboard-focus #cdf74d0 Read the assertion cases for missing and false states, visible mismatch, unchanged pixels, geometry independence, invalid focus values, and mid-capture focus changes.
 */
export function checksBrowserFocus(): void {
  const unknown = snapshot();
  const blurred = snapshot({ ...measurement(), focus: { focused: false, visible: false } });
  const keyboard = snapshot({ ...measurement(), focus: { focused: true, visible: true } });
  const pointer = snapshot({ ...measurement(), focus: { focused: true, visible: false } });
  deepStrictEqual(codes(checkSnapshot(unknown, { focus: { focused: false } })), [
    'browser.focus-missing',
  ]);
  ok(checkSnapshot(unknown).ok, 'Legacy measurements remain valid without a focus assertion.');
  ok(checkSnapshot(blurred, { focus: { focused: false, visible: false } }).ok);
  ok(checkSnapshot(keyboard, { focus: { focused: true, visible: true } }).ok);
  ok(checkSnapshot(pointer, { focus: { focused: true } }).ok);
  deepStrictEqual(codes(checkSnapshot(pointer, { focus: { focused: true, visible: true } })), [
    'browser.focus',
  ]);
  deepStrictEqual(
    codes(
      checkSnapshot(keyboard, {
        focus: { focused: true, visible: true },
        changedFrom: blurred,
      }),
    ),
    ['browser.pixels-unchanged'],
    'Focus metadata alone cannot prove a painted indicator.',
  );
  ok(checkSnapshot(keyboard, { stableGeometry: { reference: blurred.measurement } }).ok);
  throws(
    () => checkSnapshot(keyboard, { focus: { focused: false, visible: true } }),
    /Visible focus/,
  );
  throws(
    () => checkSnapshot(snapshot({ ...measurement(), focus: { focused: false, visible: true } })),
    /Visible focus/,
  );
  throws(() =>
    checkSnapshot(
      keyboard,
      { focus: { focused: 'true' } } as unknown as Parameters<typeof checkSnapshot>[1],
    ),
  );
}
void test('browser keyboard focus assertions', checksBrowserFocus);
