import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { test } from 'node:test';

import { compareSet, defaultCompareSlack } from '../src/compare.js';
import { defaultInspectOptions } from '../src/inspect.js';
import { createRaster, type Raster } from '../src/raster.js';
import {
  fill,
  fillRect,
  ornament,
  outline,
  panel,
  rim,
  ropePanel,
  setPixel,
  shadedBar,
} from './fixtures.js';

const options = {
  kind: 'states',
  slack: defaultCompareSlack,
  inspect: defaultInspectOptions,
} as const;

/** A panel like the fixture whose outline is `stroke` px thick and whose rim is `rimWidth` px. */
function framed(width: number, height: number, stroke: number, rimWidth: number): Raster {
  const raster = createRaster(width, height);
  const border = stroke + rimWidth;
  fillRect(raster, 0, 0, width, height, outline);
  fillRect(raster, stroke, stroke, width - stroke * 2, height - stroke * 2, rim);
  fillRect(raster, border, border, width - border * 2, height - border * 2, fill);
  for (const [x, y] of [
    [stroke + 1, stroke + 1],
    [width - stroke - 2, stroke + 1],
    [stroke + 1, height - stroke - 2],
    [width - stroke - 2, height - stroke - 2],
  ] as const) {
    setPixel(raster, x, y, ornament);
  }
  return raster;
}

function codes(report: { readonly findings: ReadonlyArray<{ readonly code: string }> }): string[] {
  return report.findings.map((finding) => finding.code);
}

/**
 * @evidence docs/spec.md#set-comparison Compares matching states, then states that differ in size, mode, insets beyond the slack, shared insets that cut detail, and outline weight, and a set that only compares outlines.
 * @evidenceReview docs/spec.md#set-comparison #c944cfa Checked the assertions against the section's size, mode, slack, shared-insets, and outline rules and ran this test green with pnpm test.
 */
export function comparesSets(): void {
  // Two identical states agree and share their insets.
  const same = compareSet(
    [
      { name: 'normal', raster: panel(40, 30) },
      { name: 'hover', raster: panel(40, 30) },
    ],
    options,
  );
  ok(same.ok);
  deepStrictEqual(same.findings, []);
  deepStrictEqual(same.sharedInsets, { left: 6, right: 6, top: 6, bottom: 6 });
  strictEqual(same.pieces.length, 2);
  strictEqual(same.pieces[0]?.outline, 2);

  // States of different sizes cannot swap in place.
  const sized = compareSet(
    [
      { name: 'normal', raster: panel(40, 30) },
      { name: 'pressed', raster: panel(44, 30) },
    ],
    options,
  );
  strictEqual(sized.ok, false);
  ok(codes(sized).includes('compare.size'));
  strictEqual(sized.sharedInsets, null);

  // A nine-slice and a three-slice state do not share a mode.
  const moded = compareSet(
    [
      { name: 'normal', raster: panel(48, 20) },
      { name: 'pressed', raster: shadedBar(48, 20) },
    ],
    options,
  );
  ok(codes(moded).includes('compare.mode'));
  strictEqual(moded.ok, false);

  // A thicker rim moves the detected insets past the slack; the largest insets
  // still fit both states, so the comparison only warns.
  const insets = compareSet(
    [
      { name: 'normal', raster: framed(40, 30, 2, 4) },
      { name: 'hover', raster: framed(40, 30, 2, 7) },
    ],
    options,
  );
  ok(codes(insets).includes('compare.insets'));
  ok(!codes(insets).includes('compare.shared-insets'));
  deepStrictEqual(insets.sharedInsets, { left: 9, right: 9, top: 9, bottom: 9 });
  ok(insets.ok);
  // A slack as large as the difference accepts it.
  ok(
    !codes(
      compareSet(
        [
          { name: 'normal', raster: framed(40, 30, 2, 4) },
          { name: 'hover', raster: framed(40, 30, 2, 7) },
        ],
        { ...options, slack: 3 },
      ),
    ).includes('compare.insets'),
  );

  // Each state's own insets step around its edge detail, but the largest insets
  // of both leave no stretch span, so the shared insets fail.
  const left = panel(40, 30);
  setPixel(left, 19, 4, ornament);
  const right = panel(40, 30);
  setPixel(right, 20, 4, ornament);
  const shared = compareSet(
    [
      { name: 'normal', raster: left },
      { name: 'focus', raster: right },
    ],
    options,
  );
  deepStrictEqual(shared.sharedInsets, { left: 20, right: 20, top: 6, bottom: 6 });
  ok(codes(shared).includes('compare.shared-insets'));
  strictEqual(shared.ok, false);

  // Outlines of 2 and 5 px read as different weights, for states and sets alike.
  const weights = compareSet(
    [
      { name: 'dialog', raster: framed(60, 40, 2, 4) },
      { name: 'button', raster: framed(40, 20, 5, 2) },
    ],
    { ...options, kind: 'set' },
  );
  deepStrictEqual(codes(weights), ['compare.outline']);
  strictEqual(weights.sharedInsets, null);
  ok(weights.ok);

  // A set of different sizes and modes is not held to one size or mode.
  const set = compareSet(
    [
      { name: 'dialog', raster: panel(60, 40) },
      { name: 'bar', raster: shadedBar(48, 12) },
    ],
    { ...options, kind: 'set' },
  );
  ok(!codes(set).includes('compare.size'));
  ok(!codes(set).includes('compare.mode'));

  // Tiling each state detected carries into the shared-insets check.
  const tiled = compareSet(
    [
      { name: 'normal', raster: ropePanel(96, 40) },
      { name: 'hover', raster: ropePanel(96, 40) },
    ],
    options,
  );
  ok(tiled.ok);
  ok(!codes(tiled).includes('compare.shared-insets'));

  // Without any outline, the set says it compared no line weight.
  const flat = createRaster(30, 20);
  fillRect(flat, 0, 0, 30, 20, fill);
  deepStrictEqual(
    codes(
      compareSet(
        [
          { name: 'a', raster: flat },
          { name: 'b', raster: flat },
        ],
        { ...options, kind: 'set' },
      ),
    ),
    ['compare.outline-missing'],
  );

  throws(
    () =>
      compareSet(
        [
          { name: 'a', raster: panel(40, 30) },
          { name: 'b', raster: panel(40, 30) },
        ],
        { ...options, inspect: { ...options.inspect, regions: 'multi' } },
      ),
    RangeError,
  );
  throws(() => compareSet([{ name: 'one', raster: panel(40, 30) }], options), RangeError);
  throws(
    () =>
      compareSet(
        [
          { name: 'a', raster: panel(40, 30) },
          { name: 'b', raster: panel(40, 30) },
        ],
        { ...options, slack: -1 },
      ),
    RangeError,
  );
  throws(
    () =>
      compareSet(
        [
          { name: 'a', raster: panel(40, 30) },
          { name: 'a', raster: panel(40, 30) },
        ],
        options,
      ),
    RangeError,
  );
}

void test('set comparison', comparesSets);
