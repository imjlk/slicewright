import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { cli } from 'gunshi';

import { cliOptions, main, shellCompletion, subCommands } from '../src/cli.js';
import {
  completeUsageProblem,
  completionShells,
  listCandidates,
  pathCandidates,
} from '../src/completion.js';

/** What the CLI prints on stdout for `argv`, run in this process with that command line. */
async function stdoutOf(argv: readonly string[]): Promise<string> {
  const log = console.log;
  const saved = process.argv;
  let text = '';
  console.log = (...parts: unknown[]): void => {
    text += `${parts.map(String).join(' ')}\n`;
  };
  process.argv = [saved[0] ?? 'node', saved[1] ?? 'slicewright', ...argv];
  try {
    await cli([...argv], main, cliOptions);
  } finally {
    console.log = log;
    process.argv = saved;
  }
  return text;
}

/** The candidate values of `complete -- <words>`, without descriptions or the directive. */
async function candidates(words: readonly string[]): Promise<string[]> {
  const lines = (await stdoutOf(['complete', '--', ...words])).trimEnd().split('\n');
  strictEqual(lines.at(-1), ':4', lines.join('\n'));
  return lines.slice(0, -1).map((line) => line.split('\t')[0] ?? '');
}

/**
 * @evidence docs/spec.md#shell-completion Checks the script for every shell, command and option completion, enum choices, comma-separated targets, command names, png/json/directory paths with hidden entries, and the usage errors for a missing, unknown, or extra shell.
 * @evidenceReview docs/spec.md#shell-completion #ce35ff1 Reread the section after adding pack PNG inputs and symbolic links; for scripts, candidates, paths, links, and usage errors this checks each one through the CLI in process. Ran green with pnpm test.
 */
export async function shellCompletionWorks(): Promise<void> {
  // A script for every shell names the program and asks `complete --` for candidates.
  for (const shell of completionShells) {
    const script = await stdoutOf(['complete', shell]);
    ok(script.includes('slicewright'), shell);
    ok(/complete '?--'?/.test(script), shell);
  }

  // complete --help names the shells.
  ok(
    (await stdoutOf(['complete', '--help'])).includes(
      'slicewright complete <bash|zsh|fish|powershell>',
    ),
  );

  // Commands and options.
  deepStrictEqual(await candidates(['nor']), ['normalize']);
  ok((await candidates(['inspect', '--to'])).includes('--tolerance'));

  // Enum choices, targets after the ones already listed, and command names.
  deepStrictEqual(await candidates(['normalize', 'x.png', '--mode', '']), [
    'auto',
    'nine',
    'three',
    'three-vertical',
  ]);
  const targets = await candidates(['export', 'x.png', '--target', 'phaser,']);
  ok(targets.includes('phaser,css') && !targets.includes('phaser,phaser'), targets.join(' '));
  deepStrictEqual(await candidates(['export', 'x.png', '--target=ph']), ['phaser']);
  deepStrictEqual(await candidates(['commands', 'pa']), ['pack']);

  // Every enum option completes its choices.
  for (const [name, command] of Object.entries(subCommands)) {
    for (const [key, arg] of Object.entries(command.args ?? {}) as [string, { type: string }][]) {
      if (arg.type === 'enum') {
        ok(shellCompletion[name]?.args[key] !== undefined, `${name} --${key}`);
      }
    }
  }

  // Paths: directories with a slash, files with the argument's extension, hidden on a dot.
  const dir = mkdtempSync(join(tmpdir(), 'slicewright-complete-'));
  const cwd = process.cwd();
  try {
    mkdirSync(join(dir, 'ui'));
    for (const file of [
      'ui/panel.png',
      'ui/panel.json',
      'button.png',
      'notes.txt',
      '.hidden.png',
    ]) {
      writeFileSync(join(dir, file), '');
    }
    process.chdir(dir);
    deepStrictEqual(await candidates(['inspect', '']), ['button.png', 'ui/']);
    deepStrictEqual(await candidates(['inspect', 'ui/']), ['ui/panel.png']);
    deepStrictEqual(await candidates(['pack', 'ui/']), ['ui/panel.json', 'ui/panel.png']);
    // A linked directory completes as a directory (junctions need no privilege on Windows).
    symlinkSync(join(dir, 'ui'), join(dir, 'linked'), 'junction');
    deepStrictEqual(await candidates(['export', 'x.png', '--out-dir', 'l']), ['linked/']);
    deepStrictEqual(await candidates(['inspect', '.']), ['.hidden.png']);
    deepStrictEqual(await candidates(['export', 'x.png', '--out-dir', '']), ['linked/', 'ui/']);
    deepStrictEqual(pathCandidates('missing/', { files: [] }), []);
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
  deepStrictEqual(
    listCandidates('css,', ['phaser', 'css']).map((item) => item.value),
    ['css,phaser'],
  );

  // complete takes one shell, or `--` and the words.
  strictEqual(completeUsageProblem(['complete', 'bash']), undefined);
  strictEqual(completeUsageProblem(['complete', '--', 'inspect']), undefined);
  strictEqual(completeUsageProblem(['inspect', 'x.png']), undefined);
  ok(completeUsageProblem(['complete'])?.includes('bash, zsh, fish, powershell'));
  ok(completeUsageProblem(['complete', 'tcsh'])?.startsWith('Unknown shell "tcsh"'));
  ok(completeUsageProblem(['complete', 'bash', 'zsh']) !== undefined);
}

void test('shell completion', shellCompletionWorks);
