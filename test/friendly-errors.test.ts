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
  InvalidJsonError,
  missingFile,
  parseJsonFile,
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

/** The messages the CLI would print for `argv`, or none when it parses; `null` names no command. */
async function messages(argv: string[], command: string | null = 'normalize'): Promise<string[]> {
  try {
    await cli(argv, main, {
      name: 'slicewright',
      subCommands: commands,
      renderHeader: null,
      renderValidationErrors: null,
      strict: true,
    });
  } catch (error) {
    return friendlyCliErrors(error, { ...help, command: command ?? undefined });
  }
  return [];
}

/**
 * @evidence docs/spec.md#error-messages Rewrites gunshi's missing-flag, missing-argument, choice, type, unknown-option and unknown-command errors into messages naming the fix, suggests close names by edit distance, and keeps other messages.
 * @evidenceReview docs/spec.md#error-messages #2655dd4 Reread the section after the unknown-option, invalid-JSON, and prompt missing-flag edits, checked this host against it, and ran pnpm test green.
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
  const unknown = await messages(['inspct'], null);
  ok(unknown[0]?.startsWith('Unknown command "inspct". Did you mean inspect?'), unknown.join());
  ok(unknown[0]?.endsWith('Commands: normalize, inspect, targets.'), unknown.join());
  // An unknown option takes the next word; that word is not also an unknown command or a missing argument.
  deepStrictEqual(await messages(['--bogus', 'targets', 'x.png'], 'targets'), [
    'Unknown option --bogus for targets. Run `slicewright targets --help` for the options.',
  ]);
  const swallowed = await messages(['inspect', '--bogus', 'x.png', '--out', 'y.png'], 'inspect');
  deepStrictEqual(swallowed, [
    'Unknown option --bogus for inspect. Run `slicewright inspect --help` for the options.',
  ]);
  // Without a known command, the unknown command is the mistake and stays.
  const commandless = await messages(['--bogus', 'inspct', 'x.png'], null);
  ok(
    commandless.some((message) => message.startsWith('Unknown command')),
    commandless.join('\n'),
  );
  const several = await messages(['normalize', 'a.png', '--filter', 'x', '--bogus']);
  strictEqual(several.length, 3, several.join('\n'));
  // Errors that are not the parser's keep their message.
  deepStrictEqual(friendlyCliErrors(new Error('compare needs at least two PNGs.'), help), [
    'compare needs at least two PNGs.',
  ]);
  deepStrictEqual(friendlyCliErrors('plain', help), ['plain']);
  // A JSON file that does not parse is named with the parser's reason.
  deepStrictEqual(parseJsonFile('{"a": 1}', 'x.json'), { a: 1 });
  throws(
    () => parseJsonFile('{"a": ', '--layout x.json'),
    (error: unknown) =>
      error instanceof InvalidJsonError &&
      /^--layout x\.json is not valid JSON \(.+\)\.$/u.test(error.message),
  );
}

/**
 * @evidence docs/spec.md#error-messages Reports every manifest problem at once with its path: an unknown key with the closest allowed key, a missing key, a value outside its choices, and other mismatches in words.
 * @evidenceReview docs/spec.md#error-messages #2655dd4 Reread the section after the unknown-option, invalid-JSON, and prompt missing-flag edits, checked this host against it, and ran pnpm test green.
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
 * @evidenceReview docs/spec.md#error-messages #2655dd4 Reread the section after the unknown-option, invalid-JSON, and prompt missing-flag edits, checked this host against it, and ran pnpm test green.
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
 * @evidenceReview docs/spec.md#command-line-arguments #d7f096a Reread the section after the [options] usage line, (required) marker, and exit-code edit, checked this host against it, and ran pnpm test green.
 */
export function tidiesHelp(): void {
  const entry = [
    'USAGE:',
    '  slicewright [COMMANDS] <OPTIONS>',
    '',
    'COMMANDS:',
    '  [slicewright] <OPTIONS>       Prompt and inspect',
    '  inspect <OPTIONS>             Inspect a PNG',
    '  pack <OPTIONS> <inputs>       Pack atlases',
    '  targets                       List targets',
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
    '  pack <inputs>                 Pack atlases',
    '  targets                       List targets',
    '',
    'For more info, run any command with the `--help` flag:',
    '  slicewright inspect --help',
    '',
  ]);
  const command = [
    'USAGE:',
    '  slicewright normalize <OPTIONS> <input>',
    '',
    'OPTIONS:',
    '  -h, --help             Display this help message',
    '  -v, --version          Display this version',
    '  --out <out>            Normalized PNG to write',
    '  --outline <outline>    Outline width',
    '  --crop                 Crop first',
    '  --no-crop              Negatable of --crop',
    '',
    'EXAMPLES:',
    '  slicewright normalize a.png',
    '',
  ].join('\n');
  deepStrictEqual(
    tidyUsage(command, {
      entry: false,
      negated: { crop: 'Keep margins' },
      required: ['out', 'crop'],
      exitCodes: [
        [0, 'ok'],
        [2, 'usage or input failure'],
      ],
    }).split('\n'),
    [
      'USAGE:',
      '  slicewright normalize [options] <input>',
      '',
      'OPTIONS:',
      '  --out <out>            Normalized PNG to write (required)',
      '  --outline <outline>    Outline width',
      '  --crop                 Crop first (required)',
      '  --no-crop              Keep margins',
      '  -h, --help             Display this help message',
      '  -v, --version          Display this version',
      '',
      'EXAMPLES:',
      '  slicewright normalize a.png',
      '',
      'EXIT CODES:',
      '  0  ok',
      '  2  usage or input failure',
      '',
    ],
  );
}

void test('missing files and layout errors', explainsMissingFilesAndLayouts);
void test('help text', tidiesHelp);
