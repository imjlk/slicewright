import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { cli, define } from 'gunshi';

import { BuildManifestError, readBuildManifest } from '../src/build.js';
import {
  didYouMean,
  friendlyCliErrors,
  friendlyShapeIssues,
  missingFile,
} from '../src/friendly-errors.js';
import { tidyUsage } from '../src/help.js';
import { readLayoutJson } from '../src/layout.js';

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
 * @evidenceReview docs/spec.md#error-messages #157990f Reread the section after the missing-file, layout-file, target-typo and flag-name edit, checked this test's assertions against it, and ran pnpm test green.
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
 * @evidenceReview docs/spec.md#error-messages #157990f Reread the section after the missing-file, layout-file, target-typo and flag-name edit, checked this test's assertions against it, and ran pnpm test green.
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

/**
 * @evidence docs/spec.md#error-messages Names a missing input file instead of the system error, and explains a bad layout file with what it should be and its first problems in words.
 * @evidenceReview docs/spec.md#error-messages #157990f Reread the section after the missing-file, layout-file, target-typo and flag-name edit, checked this test's assertions against it, and ran pnpm test green.
 */
export function explainsMissingFilesAndLayouts(): void {
  let missing: unknown;
  try {
    readFileSync('no-such-dir/panel.png');
  } catch (error) {
    missing = error;
  }
  strictEqual(missingFile(missing), join('no-such-dir', 'panel.png'));
  strictEqual(missingFile(new Error('other')), undefined);
  deepStrictEqual(friendlyCliErrors(missing, help), [
    `${join('no-such-dir', 'panel.png')} does not exist.`,
  ]);

  deepStrictEqual(
    friendlyShapeIssues(
      [
        { path: '$input.x', expected: 'AxisLayout', value: undefined },
        {
          path: '$input.x.segments[0].kind',
          expected: '("fixed" | "stretch" | "tile")',
          value: 'strech',
        },
      ],
      'layout',
    ),
    [
      'layout.x is required: an axis object with length and segments.',
      'layout.x.segments[0].kind must be one of "fixed", "stretch", "tile", not "strech". Did you mean "stretch"?',
    ],
  );
  throws(
    () => readLayoutJson({ ok: true, insets: { left: 1, right: 1, top: 1, bottom: 1 } }),
    (error: unknown) => {
      ok(error instanceof RangeError);
      ok(error.message.startsWith('No valid layout: give a SliceLayout'), error.message);
      ok(!error.message.includes('--insets'), error.message);
      ok(!error.message.includes('$input'), error.message);
      return true;
    },
  );
}

/**
 * @evidence docs/spec.md#command-line-arguments Drops the program's own row and the options placeholder from the command list, describes a negated flag, and moves --help and --version after a command's own options.
 * @evidenceReview docs/spec.md#command-line-arguments #f21cb56 Reread the section after the help-layout and targets-object edit, checked this test's assertions against it, and ran pnpm test green.
 */
export function tidiesHelp(): void {
  const entry = [
    'USAGE:',
    '  slicewright [COMMANDS] <OPTIONS>',
    '',
    'COMMANDS:',
    '  [slicewright] <OPTIONS>       Prompt and inspect',
    '  inspect <OPTIONS>             Inspect a PNG',
    '',
    'For more info, run any command with the `--help` flag:',
    '  slicewright --help',
    '  slicewright inspect --help',
    '',
  ].join('\n');
  deepStrictEqual(tidyUsage(entry, { entry: true }).split('\n'), [
    'USAGE:',
    '  slicewright <command> [options]',
    '',
    'COMMANDS:',
    '  inspect                       Inspect a PNG',
    '',
    'For more info, run any command with the `--help` flag:',
    '  slicewright inspect --help',
    '',
  ]);
  const command = [
    'OPTIONS:',
    '  -h, --help             Display this help message',
    '  -v, --version          Display this version',
    '  --out <out>            Normalized PNG to write',
    '  --crop                 Crop first',
    '  --no-crop              Negatable of --crop',
    '',
    'EXAMPLES:',
    '  slicewright normalize a.png',
  ].join('\n');
  deepStrictEqual(
    tidyUsage(command, { entry: false, negated: { crop: 'Keep margins' } }).split('\n'),
    [
      'OPTIONS:',
      '  --out <out>            Normalized PNG to write',
      '  --crop                 Crop first',
      '  --no-crop              Keep margins',
      '  -h, --help             Display this help message',
      '  -v, --version          Display this version',
      '',
      'EXAMPLES:',
      '  slicewright normalize a.png',
    ],
  );
}

void test('missing files and layout errors', explainsMissingFilesAndLayouts);
void test('help text', tidiesHelp);
