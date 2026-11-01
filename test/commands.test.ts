import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';

import { cli } from 'gunshi';

import { cliOptions, flagAliases, main, subCommands } from '../src/cli.js';
import {
  describeCommands,
  type CatalogOption,
  type CommandCatalog,
} from '../src/command-catalog.js';

/** Runs the CLI in this process and returns what it printed on stdout. */
async function stdoutOf(argv: readonly string[]): Promise<string> {
  const write = process.stdout.write;
  let text = '';
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    text += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    await cli([...argv], main, cliOptions);
  } finally {
    process.stdout.write = write;
  }
  return text;
}

/**
 * @evidence docs/spec.md#command-catalog Checks every command and every argument of the definitions against the printed catalog: type, required, default, choices, negatable, short form, second names, exit codes, and examples, and that an unknown name is refused with a suggestion.
 * @evidenceReview docs/spec.md#command-catalog #14c5656 Reread the section with handler-required flags (prompt --kind/--style); this asserts every definition field it lists (type, required, default, choices, negatable, short, second names), the exit codes, examples, one-command output, and the unknown-name suggestion. Ran green with pnpm test.
 */
export async function catalogMatchesDefinitions(): Promise<void> {
  // slicewright commands describes every definition as it is
  {
    const catalog = JSON.parse(await stdoutOf(['commands'])) as CommandCatalog;
    strictEqual(catalog.name, 'slicewright');
    strictEqual(catalog.version, cliOptions.version);
    deepStrictEqual(Object.keys(catalog.exitCodes), ['0', '1', '2']);
    deepStrictEqual(
      catalog.commands.map((command) => command.name),
      Object.keys(subCommands),
    );
    for (const [name, command] of Object.entries(subCommands)) {
      const described = catalog.commands.find((entry) => entry.name === name);
      ok(described, name);
      strictEqual(described.description, command.description);
      ok(described.usage.startsWith(`slicewright ${name}`), described.usage);
      ok(described.exitCodes.includes(0) && described.exitCodes.includes(2), name);
      for (const line of described.examples) {
        ok(line.startsWith(`slicewright ${name}`), `${name} example: ${line}`);
      }
      const args = Object.entries(command.args ?? {}) as [string, Record<string, unknown>][];
      deepStrictEqual(
        described.arguments.map((arg) => [arg.name, arg.required, arg.multiple]),
        args
          .filter(([, arg]) => arg['type'] === 'positional')
          .map(([key, arg]) => [
            key,
            arg['multiple'] === true
              ? arg['required'] === true
              : arg['required'] !== false && arg['default'] === undefined,
            arg['multiple'] === true,
          ]),
        name,
      );
      const options = args.filter(([, arg]) => arg['type'] !== 'positional');
      deepStrictEqual(
        described.options.map((option) => option.key),
        options.map(([key]) => key),
        name,
      );
      for (const [key, arg] of options) {
        const option: CatalogOption | undefined = described.options.find(
          (entry) => entry.key === key,
        );
        ok(option, `${name} --${key}`);
        strictEqual(option.name, `--${key}`);
        strictEqual(option.type, arg['type']);
        strictEqual(
          option.required,
          arg['required'] === true || (name === 'prompt' && (key === 'kind' || key === 'style')),
          `${name} --${key} required`,
        );
        deepStrictEqual(option.default, arg['default'] ?? null, `${name} --${key} default`);
        deepStrictEqual(option.choices, arg['choices'] ?? null, `${name} --${key} choices`);
        strictEqual(option.description, arg['description'] ?? '');
        strictEqual(option.negatable, arg['negatable'] === true);
        strictEqual(option.short, arg['short'] === undefined ? null : `-${String(arg['short'])}`);
      }
    }
    const exiting = catalog.commands.filter((command) => command.exitCodes.includes(1));
    deepStrictEqual(exiting.map((command) => command.name).sort(), [
      'atlas',
      'browser-report',
      'build',
      'compare',
      'export',
      'frame',
      'inspect',
      'normalize',
      'pack',
    ]);
    const normalize = catalog.commands.find((command) => command.name === 'normalize');
    strictEqual(normalize?.options.find((option) => option.key === 'crop')?.negatable, true);
  }

  // second flag names point at flags the command defines
  {
    const catalog = describeCommands({
      name: 'slicewright',
      version: '0',
      description: '',
      commands: subCommands,
      exits: {},
      aliases: flagAliases,
    });
    for (const [name, aliases] of Object.entries(flagAliases)) {
      const described = catalog.commands.find((command) => command.name === name);
      ok(described, name);
      for (const [alias, target] of Object.entries(aliases)) {
        const second: CatalogOption | undefined = described.options.find(
          (option) => option.key === alias,
        );
        const first: CatalogOption | undefined = described.options.find(
          (option) => option.key === target,
        );
        strictEqual(second?.aliasOf, `--${target}`, `${name} --${alias}`);
        ok(first?.aliases.includes(`--${alias}`), `${name} --${target}`);
        strictEqual(first?.aliasOf, null);
      }
    }
  }

  // slicewright commands <name> describes one command and refuses unknown names
  {
    const one = JSON.parse(await stdoutOf(['commands', 'key'])) as CommandCatalog;
    deepStrictEqual(
      one.commands.map((command) => command.name),
      ['key'],
    );
    deepStrictEqual(one.commands[0]?.examples, [
      'slicewright key generated.png --out keyed.png',
      'slicewright key generated.png --out keyed.png --key magenta',
    ]);
    deepStrictEqual(
      one.commands[0]?.arguments.map((arg) => [arg.name, arg.required]),
      [['input', true]],
    );
    await rejects(
      stdoutOf(['commands', 'inspct']),
      /Unknown command "inspct"\. Did you mean inspect\?/,
    );
  }
}
void test('command catalog', catalogMatchesDefinitions);
