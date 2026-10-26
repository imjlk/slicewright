import { extname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import type { Page } from 'playwright-core';

import { decodePng } from '../src/png.js';
import { cropRaster, rasterDifference, type RasterDifference, type Rect } from '../src/raster.js';

type State = 'normal' | 'hover' | 'pressed' | 'disabled';

interface Measurement {
  readonly renderer: number;
  readonly sameButton: boolean;
  readonly sameLabel: boolean;
  readonly frame: string;
  readonly referenceFrame: string;
  readonly button: Rect;
  readonly label: Rect;
  readonly reference: Rect;
  readonly referenceLabel: Rect;
  readonly insets: readonly number[];
  readonly referenceInsets: readonly number[];
}

interface StateApi {
  show: (state: State, refreshUV: boolean) => Promise<Measurement>;
  resize: (width: number, height: number) => Promise<Measurement>;
}

interface Comparison {
  readonly size: string;
  readonly state: State;
  readonly mean: number;
  readonly max: number;
}

function problems(
  actual: Measurement,
  baseline: Measurement,
  state: State,
  width: number,
  height: number,
  pixels: RasterDifference,
): string[] {
  const found: string[] = [];
  if (actual.renderer !== 2 || !actual.sameButton || !actual.sameLabel) {
    found.push('WebGL button or label instance was lost');
  }
  if (actual.frame !== `btn-${state}` || actual.referenceFrame !== `btn-${state}`) {
    found.push('requested frame was not selected');
  }
  if (!isDeepStrictEqual(actual.button, { x: 32, y: 64, width, height }) ||
    !isDeepStrictEqual(actual.reference, { x: 672, y: 64, width, height })) {
    found.push('button bounds changed');
  }
  if (!isDeepStrictEqual(actual.label, baseline.label) ||
    !isDeepStrictEqual(actual.referenceLabel, { ...actual.label, x: actual.label.x + 640 }) ||
    actual.label.width <= 0 || actual.label.height <= 0 ||
    actual.label.x < actual.button.x || actual.label.y < actual.button.y ||
    actual.label.x + actual.label.width > actual.button.x + width ||
    actual.label.y + actual.label.height > actual.button.y + height) {
    found.push('label bounds changed or exceed the button');
  }
  if (!isDeepStrictEqual(actual.insets, [20, 21, 20, 19]) ||
    !isDeepStrictEqual(actual.referenceInsets, actual.insets)) {
    found.push('shared slice borders changed');
  }
  // Same GPU, frame, size, integer position, label and background: only a tiny
  // rounding allowance is needed. A frame name or differing hash is no oracle.
  if (!Number.isFinite(pixels.mean) || !Number.isFinite(pixels.max) ||
    pixels.mean > 0.1 || pixels.max > 2) {
    found.push('rendered pixels differ from expected frame');
  }
  return found;
}

async function show(page: Page, state: State, refreshUV = true): Promise<Measurement> {
  return page.evaluate(
    async ({ nextState, refresh }) => (globalThis as unknown as {
      slicewrightStates: StateApi;
    }).slicewrightStates.show(nextState, refresh),
    { nextState: state, refresh: refreshUV },
  );
}

/** Checks real frame swaps, including a stale-UV mutation that must be rejected. */
export async function checkPhaserStates(page: Page, baseUrl: string, screenshot?: string): Promise<{
  cases: Comparison[];
  negativeControls: Comparison[];
  failing: string[];
}> {
  const cases: Comparison[] = [];
  const negativeControls: Comparison[] = [];
  const failing: string[] = [];
  page.on('pageerror', (error) => failing.push(`browser: ${error.message}`));
  await page.goto(`${baseUrl}/examples/phaser-states/index.html`);
  await page.waitForFunction(() => 'slicewrightStates' in globalThis);
  for (const [size, width, height] of [
    ['small', 188, 62],
    ['large', 576, 100],
  ] as const) {
    const baseline = await page.evaluate(
      async ([w, h]) => (globalThis as unknown as {
        slicewrightStates: StateApi;
      }).slicewrightStates.resize(w, h),
      [width, height] as const,
    );
    const capture = async (name: string): Promise<RasterDifference> => {
      const path = screenshot === undefined
        ? undefined
        : `${screenshot.slice(0, screenshot.length - extname(screenshot).length)}.states-${size}-${name}.png`;
      const png = await page.locator('canvas').screenshot(path === undefined ? {} : { path });
      const raster = decodePng(png);
      // Fixed rectangles come from the requested geometry, not a potentially
      // broken runtime measurement that could hide part of the button.
      return rasterDifference(
        cropRaster(raster, { x: 32, y: 64, width, height }),
        cropRaster(raster, { x: 672, y: 64, width, height }),
      );
    };
    // Return paths matter too: normal must render correctly after another state.
    const states: readonly State[] = [
      'normal',
      'hover',
      'pressed',
      'hover',
      'normal',
      'disabled',
      'normal',
    ];
    for (const [index, state] of states.entries()) {
      const actual = await show(page, state);
      const pixels = await capture(`${index}-${state}`);
      cases.push({ size, state, mean: pixels.mean, max: pixels.max });
      failing.push(...problems(actual, baseline, state, width, height, pixels)
        .map((problem) => `${size}/${index}/${state}: ${problem}`));
    }
    for (const state of ['hover', 'pressed', 'disabled'] as const) {
      await show(page, 'normal');
      const actual = await show(page, state, false);
      const pixels = await capture(`stale-${state}`);
      const rejected = problems(actual, baseline, state, width, height, pixels);
      // The logical frame and geometry must still pass: the pixel assertion
      // itself, not another incidental failure, must catch each mutation.
      if (!isDeepStrictEqual(rejected, ['rendered pixels differ from expected frame'])) {
        failing.push(
          `${size}/${state}: stale UV control was not rejected solely by pixels (${rejected.join(', ')})`,
        );
      } else {
        negativeControls.push({ size, state, mean: pixels.mean, max: pixels.max });
      }
    }
  }
  await page.close();
  return { cases, negativeControls, failing };
}
