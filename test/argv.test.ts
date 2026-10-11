import { deepStrictEqual, throws } from 'node:assert/strict';
import { test } from 'node:test';

import { joinNegativeNumbers } from '../src/argv.js';

/**
 * @evidence docs/spec.md#command-line-arguments Joins negative integers, decimals, and exponents to number flags only, and leaves joined values, other flags, and arguments after -- alone.
 * @evidenceReview docs/spec.md#command-line-arguments #f243c46 Checked the assertions against the section and ran this test green with pnpm test.
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
  // Positive numbers, joined values, and other text are left to the parser.
  deepStrictEqual(joinNegativeNumbers(['--tolerance', '4', '--spacing=-1', '--zoom', 'x'], flags), [
    '--tolerance',
    '4',
    '--spacing=-1',
    '--zoom',
    'x',
  ]);
  // A flag that takes no number keeps a following negative-looking token as is.
  deepStrictEqual(joinNegativeNumbers(['--style', '-1'], flags), ['--style', '-1']);
  // Nothing after -- is an option.
  deepStrictEqual(joinNegativeNumbers(['--', '--tolerance', '-1'], flags), [
    '--',
    '--tolerance',
    '-1',
  ]);
  // Repeated flags each get their value; a value already given keeps what follows.
  deepStrictEqual(joinNegativeNumbers(['--zoom', '-1', '--zoom', '-2'], flags), [
    '--zoom=-1',
    '--zoom=-2',
  ]);
  deepStrictEqual(joinNegativeNumbers(['--zoom=2', '-5'], flags), ['--zoom=2', '-5']);
  // A number flag without a value is refused by name instead of crashing the parser.
  throws(() => joinNegativeNumbers(['--tolerance'], flags), /--tolerance needs a number\./);
  throws(() => joinNegativeNumbers(['--tolerance', '--noise', 'off'], flags), /got --noise/);
  throws(() => joinNegativeNumbers(['--tolerance', '-x'], flags), /got -x/);
}

void test('command-line arguments', joinsNegativeNumbers);
