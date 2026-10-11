import { deepStrictEqual } from 'node:assert/strict';
import { test } from 'node:test';

import { joinNegativeNumbers } from '../src/argv.js';

/**
 * @evidence docs/spec.md#command-line-arguments Joins negative integers, decimals, and exponents to number flags only, and leaves joined values, other flags, and arguments after -- alone.
 * @evidenceReview docs/spec.md#command-line-arguments #57b0fed Checked the assertions against the section and ran this test green with pnpm test.
 */
export function joinsNegativeNumbers(): void {
  const flags = new Set(['--tolerance', '--spacing', '--zoom']);
  deepStrictEqual(
    joinNegativeNumbers(['inspect', 'a.png', '--tolerance', '-1', '--zoom', '-0.5'], flags),
    ['inspect', 'a.png', '--tolerance=-1', '--zoom=-0.5'],
  );
  deepStrictEqual(joinNegativeNumbers(['--spacing', '-.5', '--zoom', '-1e3'], flags), [
    '--spacing=-.5',
    '--zoom=-1e3',
  ]);
  // Positive numbers, joined values, and non-numbers are not touched.
  deepStrictEqual(
    joinNegativeNumbers(['--tolerance', '4', '--spacing=-1', '--zoom', '-x'], flags),
    ['--tolerance', '4', '--spacing=-1', '--zoom', '-x'],
  );
  // A flag that takes no number keeps a following negative-looking token as is.
  deepStrictEqual(joinNegativeNumbers(['--style', '-1'], flags), ['--style', '-1']);
  // Nothing after -- is an option.
  deepStrictEqual(joinNegativeNumbers(['--', '--tolerance', '-1'], flags), [
    '--',
    '--tolerance',
    '-1',
  ]);
  deepStrictEqual(joinNegativeNumbers(['--tolerance'], flags), ['--tolerance']);
}

void test('command-line arguments', joinsNegativeNumbers);
