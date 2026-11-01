import { ok, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { ArgsValidationError } from 'gunshi';
import { generate } from 'gunshi/generator';

import { cliOptions, main, subCommands } from '../src/cli.js';
import { commandReference } from '../src/command-reference.js';
import { friendlyCliErrors } from '../src/friendly-errors.js';

/**
 * @evidence docs/spec.md#command-reference Regenerates the command reference from the definitions through gunshi's generate() and fails while docs/commands.md differs, ignoring line endings; checks every command has a section and no version is written.
 * @evidenceReview docs/spec.md#command-reference #fac00cd Reread the new section; this compares the committed page with a fresh render, checks the section order and that the version is absent. Ran green with pnpm test.
 */
export async function commandReferenceIsCurrent(): Promise<void> {
  const fresh = await commandReference(cliOptions.name, Object.keys(subCommands), (name) =>
    generate(name, main, cliOptions),
  );
  const committed = readFileSync(new URL('../docs/commands.md', import.meta.url), 'utf8').replace(
    /\r\n/g,
    '\n',
  );
  strictEqual(committed, fresh, 'docs/commands.md is stale: run pnpm docs:commands');
  const headings = fresh.split('\n').filter((line) => line.startsWith('## '));
  strictEqual(
    headings.join('\n'),
    ['## slicewright', ...Object.keys(subCommands).map((name) => `## slicewright ${name}`)].join(
      '\n',
    ),
  );
  ok(!fresh.includes(cliOptions.version), 'the page names no version');
  ok(fresh.includes('--outlier-ratio'), 'option rows are rendered');
}
void test('command reference', commandReferenceIsCurrent);

/**
 * The parse errors gunshi 1.0 adds (`args-tokens` 1.0) get the same friendly
 * messages as today's: a flag given without its value, and a value given to a
 * flag that takes none.
 */
export function explainsGunshiOneParseErrors(): void {
  const missing = (values: Record<string, unknown>, command?: string): string[] =>
    friendlyCliErrors(
      new ArgsValidationError('Optional argument requires a value', {
        code: 'err:arg:missing-value',
        values,
      } as unknown as ConstructorParameters<typeof ArgsValidationError>[1]),
      { command, commands: Object.keys(subCommands) },
    );
  strictEqual(
    missing({ name: 'out', expected: 'string' }, 'preview')[0],
    'preview needs --out <value>. Run `slicewright preview --help` for the options.',
  );
  strictEqual(
    missing({ name: 'mode', choiceValues: ['auto', 'nine', 'three'] }, 'inspect')[0],
    '--mode needs one of auto, nine, three. Run `slicewright inspect --help` for the options.',
  );
  const unexpected = friendlyCliErrors(
    new ArgsValidationError("Optional argument '--no-crop' does not take a value", {
      code: 'err:arg:unexpected-value',
      values: { name: 'crop', rawName: '--no-crop', actual: 'false' },
    } as unknown as ConstructorParameters<typeof ArgsValidationError>[1]),
    { command: 'normalize', commands: Object.keys(subCommands) },
  );
  strictEqual(
    unexpected[0],
    '--no-crop takes no value; drop "=false". Run `slicewright normalize --help` for the options.',
  );
}
void test('gunshi 1.0 parse errors', explainsGunshiOneParseErrors);
