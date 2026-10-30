import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { test } from 'node:test';

import { createStabilityObserver } from '../src/browser-stability.js';
import type { BrowserContent, BrowserSnapshot } from '../src/browser.js';
import { createRaster } from '../src/raster.js';

function snapshot(red = 0): BrowserSnapshot {
  const bounds = { x: 3, y: 4, width: 2, height: 2 };
  const raster = createRaster(2, 2);
  raster.data.fill(red);
  return { measurement: { bounds }, clip: { ...bounds }, raster };
}

/**
 * @evidence docs/spec.md#browser-sustained-stability Exercises duration boundaries, reset anchors, cumulative drift, copied state, metadata and malformed options without wall-clock sleeps.
 * @evidenceReview docs/spec.md#browser-sustained-stability #e0157b2 Ran all 55 unit tests including null-prototype pending, stable-window and real-text-change regressions; rechecked timing, copied-buffer and validation controls.
 */
export function checksSustainedStability(): void {
  const observe = createStabilityObserver({ duration: 100 });
  strictEqual(observe(snapshot(), 0).pending, true);
  strictEqual(observe(snapshot(), 99).pending, true);
  strictEqual(observe(snapshot(), 100).report.ok, true);
  strictEqual(observe(snapshot(10), 101).pending, false);
  strictEqual(observe(snapshot(10), 200).report.ok, false);
  strictEqual(observe(snapshot(10), 201).report.ok, true);

  const drift = createStabilityObserver({ duration: 100, pixels: { mean: 2, p99: 2, max: 2 } });
  drift(snapshot(), 0);
  strictEqual(drift(snapshot(2), 50).pending, true);
  const changed = drift(snapshot(4), 100);
  strictEqual(changed.pending, false);
  strictEqual(changed.report.ok, false);
  strictEqual(changed.reference.raster.data[0], 0);
  strictEqual(drift(snapshot(4), 200).report.ok, true);

  const dictionary: Record<string, BrowserContent> = Object.create(null);
  dictionary.label = { bounds: snapshot().clip, text: 'Ready' };
  const custom = { ...snapshot(), measurement: { ...snapshot().measurement, content: dictionary } };
  const values = createStabilityObserver({ duration: 100 });
  strictEqual(values(custom, 0).pending, true, 'An object prototype is not an observed change.');
  strictEqual(values(custom, 100).report.ok, true);
  dictionary.label = { bounds: snapshot().clip, text: 'Changed' };
  strictEqual(values(custom, 101).pending, false);
  strictEqual(values(custom, 102).report.ok, false);

  const reused = snapshot();
  const copied = createStabilityObserver({ duration: 10 });
  const first = copied(reused, 0);
  first.reference.raster.data.fill(20);
  reused.raster.data.fill(20);
  strictEqual(copied(reused, 10).report.ok, false);

  const variants: BrowserSnapshot[] = [
    { ...snapshot(), clip: { ...snapshot().clip, x: 4 } },
    { ...snapshot(), measurement: { bounds: { ...snapshot().measurement.bounds, x: 4 } } },
    {
      ...snapshot(),
      measurement: { ...snapshot().measurement, focus: { focused: true, visible: true } },
    },
    {
      ...snapshot(),
      measurement: {
        ...snapshot().measurement,
        content: { title: { bounds: snapshot().clip, text: 'Changed' } },
      },
    },
    {
      ...snapshot(),
      rendering: {
        viewport: { width: 10, height: 10 },
        deviceScaleFactor: 2,
        runnerPlatform: 'test',
      },
    },
  ];
  for (const variant of variants) {
    const state = createStabilityObserver({ duration: 10 });
    state(snapshot(), 0);
    ok(
      state(variant, 10).report.findings.some(
        (finding) => finding.code === 'browser.stability-state',
      ),
    );
  }
  const rendering = {
    viewport: { width: 10, height: 10 },
    deviceScaleFactor: 1,
    runnerPlatform: 'test',
  };
  const context = createStabilityObserver({ duration: 10 });
  context({ ...snapshot(), rendering }, 0);
  strictEqual(
    context({ ...snapshot(), rendering: { ...rendering, labels: { font: 'declared' }, runnerPlatform: 'remote' } }, 10).report.ok,
    true,
  );
  strictEqual(
    context({ ...snapshot(), rendering: { ...rendering, deviceScaleFactor: 2 } }, 20).report.ok,
    false,
  );

  for (const duration of [0, -1, NaN, Infinity]) {
    throws(() => createStabilityObserver({ duration }));
  }
  for (const max of [-1, NaN, Infinity]) {
    throws(() => createStabilityObserver({ pixels: { mean: 0, p99: 0, max } }));
  }
  const timed = createStabilityObserver();
  timed(snapshot(), 0);
  throws(() => timed(snapshot(), -1), /monotonic/);
  throws(() => timed(snapshot(), Infinity), /monotonic/);
  throws(() => timed({ ...snapshot(), raster: createRaster(1, 1) }, 10));
  deepStrictEqual(timed(snapshot(), 200).report.findings, []);
}

void test('sampled browser stability', checksSustainedStability);
