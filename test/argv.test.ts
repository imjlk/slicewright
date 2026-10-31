import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { aliasedValue, joinNegativeNumbers } from '../src/argv.js';

/**
 * @evidence docs/spec.md#command-line-arguments Joins negative integers, decimals, and exponents to number flags only, and leaves joined values, other flags, and arguments after -- alone.
 * @evidenceReview docs/spec.md#command-line-arguments #07def6c Reread the section with the new flag-alias paragraph; this still covers the negative-number rules, which are unchanged, and the aliases are cited by aliasedValue/readsFlagAliases. Ran green with pnpm test.
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

/**
 * @evidence docs/spec.md#command-line-arguments Reads either name of an aliased flag, keeps the original name's default when neither is typed, and refuses both names at once.
 * @evidenceReview docs/spec.md#command-line-arguments #07def6c Checked against the flag-alias paragraph of the section (either name, original default kept, both refused) and ran readsFlagAliases green with pnpm test.
 */
export function readsFlagAliases(): void {
  const values = { kind: 'states', as: undefined };
  strictEqual(
    aliasedValue<string>({ values, explicit: { kind: false, as: false } }, 'kind', 'as'),
    'states',
  );
  strictEqual(
    aliasedValue<string>(
      { values: { kind: 'states', as: 'set' }, explicit: { kind: false, as: true } },
      'kind',
      'as',
    ),
    'set',
  );
  strictEqual(
    aliasedValue<string>(
      { values: { kind: 'set', as: undefined }, explicit: { kind: true, as: false } },
      'kind',
      'as',
    ),
    'set',
  );
  strictEqual(aliasedValue<number>({ values: { keep: 40 } }, 'keep', 'keep-below'), 40);
  throws(
    () =>
      aliasedValue(
        { values: { keep: 30, 'keep-below': 20 }, explicit: { keep: true, 'keep-below': true } },
        'keep',
        'keep-below',
      ),
    /--keep-below is another name for --keep; give only one of them\./,
  );
  // Every alias the CLI accepts is documented under both names.
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  for (const [name, alias] of [
    ['--keep', '--keep-below'],
    ['--drop', '--drop-above'],
    ['--kind', '--as'],
  ] as const) {
    // Either `--as` alone or with its value, such as `--as set`.
    ok(
      [name, alias].every((flag) => new RegExp(`\`${flag}[\` ]`).test(readme)),
      `${name} / ${alias}`,
    );
  }
}
void test('flag aliases', readsFlagAliases);
