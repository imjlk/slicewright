import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { test } from 'node:test';

import { cli, define } from 'gunshi';

import { BuildManifestError, readBuildManifest } from '../src/build.js';
import { didYouMean, friendlyCliErrors } from '../src/friendly-errors.js';

const normalize = define({
  name: 'normalize',
  args: {
    input: { type: 'positional', description: 'PNG image' },
    out: { type: 'string', required: true },
    filter: { type: 'enum', choices: ['area', 'nearest'], default: 'area' },
    tolerance: { type: 'number' },
  },
  run: () => undefined,
});
const main = define({ name: 'slicewright', run: () => undefined });
const commands = { normalize, inspect: normalize, targets: normalize };
const help = { command: 'normalize', commands: Object.keys(commands) };

/** The messages the CLI would print for `argv`, or none when it parses. */
async function messages(argv: string[], command: string | undefined = 'normalize'): Promise<string[]> {
  try {
    await cli(argv, main, {
      name: 'slicewright',
      subCommands: commands,
      renderHeader: null,
      renderValidationErrors: null,
      strict: true,
    });
  } catch (error) {
    return friendlyCliErrors(error, { ...help, command });
  }
  return [];
}

/**
 * @evidence docs/spec.md#error-messages Rewrites gunshi's missing-flag, missing-argument, choice, type, unknown-option and unknown-command errors into messages naming the fix, suggests close names by edit distance, and keeps other messages.
 * @evidenceReview docs/spec.md#error-messages #ed1adaa Checked the assertions against the section and ran this test green with pnpm test.
 */
export async function rewritesCliErrors(): Promise<void> {
  strictEqual(didYouMean('--tolerence', ['--out', '--tolerance']), '--tolerance');
  strictEqual(didYouMean('nien', ['auto', 'nine', 'three']), 'nine');
  strictEqual(didYouMean('NEAREST', ['area', 'nearest']), 'nearest');
  strictEqual(didYouMean('xyz', ['area', 'nearest']), undefined);
  strictEqual(didYouMean('ab', ['abc']), 'abc');

  deepStrictEqual(await messages(['normalize', 'a.png']), [
    'normalize needs --out <value>. Run `slicewright normalize --help` for the options.',
  ]);
  deepStrictEqual(await messages(['normalize', 'a.png', '--out', 'b.png', '--filter', 'neares']), [
    '--filter must be one of area, nearest, not "neares". Did you mean --filter nearest?',
  ]);
  deepStrictEqual(await messages(['normalize', 'a.png', '--out', 'b.png', '--tolerence', '3']), [
    'Unknown option --tolerence for normalize. Did you mean --tolerance? Run `slicewright normalize --help` for the options.',
  ]);
  const typed = await messages(['normalize', 'a.png', '--out', 'b.png', '--tolerance', 'abc']);
  ok(typed[0]?.startsWith('--tolerance takes a number, not "abc".'), typed.join());
  const unknown = await messages(['inspct'], undefined);
  ok(unknown[0]?.startsWith('Unknown command "inspct". Did you mean inspect?'), unknown.join());
  ok(unknown[0]?.endsWith('Commands: normalize, inspect, targets.'));
  const several = await messages(['normalize', 'a.png', '--filter', 'x', '--bogus']);
  strictEqual(several.length, 3, several.join('\n'));
  // Errors that are not the parser's keep their message.
  deepStrictEqual(friendlyCliErrors(new Error('compare needs at least two PNGs.'), help), [
    'compare needs at least two PNGs.',
  ]);
  deepStrictEqual(friendlyCliErrors('plain', help), ['plain']);
}

/**
 * @evidence docs/spec.md#error-messages Reports every manifest problem at once with its path: an unknown key with the closest allowed key, a missing key, a value outside its choices, and other mismatches in words.
 * @evidenceReview docs/spec.md#error-messages #ed1adaa Checked the assertions against the section and ran this test green with pnpm test.
 */
export function explainsManifestErrors(): void {
  const problems = (json: unknown): string => {
    try {
      readBuildManifest(json);
    } catch (error) {
      ok(error instanceof BuildManifestError);
      return error.message;
    }
    throw new Error('expected the manifest to be refused');
  };
  strictEqual(
    problems({ out: 'ui.png', pieces: [{ input: 'a.png', widht: 40 }] }),
    'pieces[0].widht is not a key of pieces[0]. Did you mean "width"? Allowed: input, name, width, height, scale, filter, crop, keep, insets, padding, mode, regions, tile, tolerance, outlierRatio, noise, targets.',
  );
  const many = problems({
    out: 'ui.png',
    spacng: 2,
    pieces: [{ input: 'a.png', mode: 'nien', tolerance: '3', width: 1.5 }],
  });
  ok(many.startsWith('4 problems:\n  '), many);
  for (const line of [
    '  pieces[0].width must be a whole number, at least 1, not 1.5.',
    '  pieces[0].mode must be one of "auto", "nine", "three", "three-vertical", not "nien". Did you mean "nine"?',
    '  pieces[0].tolerance must be a number, at least 0, at most 255, not "3".',
    '  spacng is not a key of the manifest. Did you mean "spacing"?',
  ]) {
    ok(many.includes(line), `${line}\n${many}`);
  }
  strictEqual(problems({ pieces: [{ input: 'a.png' }] }), 'out is required: a string.');
  strictEqual(
    problems({ out: 'ui.png', pieces: [] }),
    'pieces must be a list, with at least 1 entry, not [].',
  );
  strictEqual(
    problems({
      out: 'ui.png',
      pieces: [{ input: 'a.png' }],
      groups: [{ name: 'g', pieces: ['a'] }],
    }),
    'groups[0].pieces must be a list of strings, with at least 2 entries, not ["a"].',
  );
  // A far-off key gets the allowed keys but no guess.
  ok(
    !problems({ out: 'ui.png', pieces: [{ input: 'a.png' }], zzzzzz: 1 }).includes('Did you mean'),
  );
  // Rules beyond the shape keep their own messages.
  throws(
    () => readBuildManifest({ out: 'ui.png', pieces: [{ input: 'a.png', scale: 2, width: 40 }] }),
    BuildManifestError,
  );
}

void test('friendly CLI errors', rewritesCliErrors);
void test('friendly manifest errors', explainsManifestErrors);
