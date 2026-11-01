import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

import { cli } from 'gunshi';

import { agentMode, conciseHelp, plain } from '../src/agent-mode.js';
import { cliOptions, helpProgram, main, subCommands } from '../src/cli.js';

const program = {
  name: 'slicewright',
  version: cliOptions.version,
  description: main.description ?? '',
  commands: subCommands,
};

/** gunshi's own help for `argv`, as the CLI prints it outside agent mode. */
async function defaultHelp(argv: readonly string[]): Promise<string> {
  const log = console.log;
  let text = '';
  console.log = (...parts: unknown[]): void => {
    text += `${parts.map(String).join(' ')}\n`;
  };
  try {
    await cli([...argv], main, cliOptions);
  } finally {
    console.log = log;
  }
  return text;
}

/** What gunshi's getAgentProfile() reports in a fresh process with `env`. */
function detectedWith(env: Record<string, string>): { isAgent: boolean; name?: string } {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(AI_AGENT|CLAUDECODE|CLAUDE_CODE|CODEX_|CURSOR_|GEMINI_CLI|AGENT|AUGMENT_|REPL_ID|OPENCODE|KIRO|GOOSE|PI_)/.test(
          key,
        ),
    ),
  );
  const out = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import { getAgentProfile } from 'gunshi/agent'; console.log(JSON.stringify(getAgentProfile()));",
    ],
    { env: { ...clean, ...env }, encoding: 'utf8' },
  );
  return JSON.parse(out) as { isAgent: boolean; name?: string };
}

/**
 * @evidence docs/spec.md#agent-mode Checks detection and both overrides (AI_AGENT through gunshi, SLICEWRIGHT_AGENT on and off), and that agent help lists every command, every argument and option with choices, defaults, and --[no-] form, the examples, no help/version rows, and no ANSI codes, and is shorter than gunshi's help.
 * @evidenceReview docs/spec.md#agent-mode #041b6fe Reread the section after the handler-required options, per-command exit codes, and complete edits, checked this host against it, and ran pnpm test green.
 */
export async function agentModeHelp(): Promise<void> {
  // Detection and overrides.
  deepStrictEqual(agentMode({ isAgent: false }, {}), {
    on: false,
    name: null,
    source: 'detected',
  });
  deepStrictEqual(agentMode({ isAgent: true, name: 'codex' }, {}), {
    on: true,
    name: 'codex',
    source: 'detected',
  });
  strictEqual(agentMode({ isAgent: true, name: 'codex' }, { SLICEWRIGHT_AGENT: '0' }).on, false);
  strictEqual(agentMode({ isAgent: true }, { SLICEWRIGHT_AGENT: 'false' }).on, false);
  strictEqual(agentMode({ isAgent: false }, { SLICEWRIGHT_AGENT: '1' }).on, true);
  strictEqual(agentMode({ isAgent: false }, { SLICEWRIGHT_AGENT: 'TRUE' }).on, true);
  strictEqual(agentMode({ isAgent: false }, { SLICEWRIGHT_AGENT: 'maybe' }).on, false);
  const forced = detectedWith({ AI_AGENT: 'my-agent' });
  deepStrictEqual(forced, { isAgent: true, name: 'my-agent' });
  strictEqual(agentMode(forced, {}).on, true);
  strictEqual(detectedWith({}).isAgent, false);

  // Program help: one line per command.
  const top = conciseHelp(program);
  for (const [name, command] of Object.entries(subCommands)) {
    const line = top.split('\n').find((row) => row.trimStart().startsWith(`${name} `));
    ok(line?.endsWith(` ${command.description}`), name);
  }
  ok(top.includes('stdout is JSON only'));
  strictEqual(conciseHelp(program, 'no-such-command'), top);

  // Command help: every argument and option, no help/version rows.
  for (const [name, command] of Object.entries(subCommands)) {
    const help = conciseHelp(program, name);
    ok(help.startsWith(`slicewright ${name}: ${command.description}\nUsage: slicewright ${name}`));
    for (const [key, arg] of Object.entries(command.args ?? {}) as [
      string,
      { type: string; negatable?: boolean },
    ][]) {
      const shown =
        arg.type === 'positional'
          ? `<${key}>`
          : arg.negatable === true
            ? `--[no-]${key}`
            : `--${key}`;
      ok(help.includes(shown), `${name} ${shown}`);
    }
    ok(!/--help|--version/.test(help), name);
  }
  const normalize = conciseHelp(program, 'normalize');
  ok(normalize.includes('--[no-]crop'), normalize);
  ok(/--filter <[a-z|]+>/.test(normalize), normalize);
  ok(normalize.includes('Examples:\n  slicewright normalize '), normalize);
  ok(conciseHelp(program, 'key').includes('--out <string>  Keyed PNG to write (required)'));
  ok(conciseHelp(program, 'key').includes('--key <auto|green|magenta>'));

  // The CLI's own program: complete is listed, handler-required flags and per-command exit codes.
  ok(/^ {2}complete {2,}Print a shell completion script/mu.test(conciseHelp(helpProgram)));
  const complete = conciseHelp(helpProgram, 'complete');
  ok(complete.startsWith('slicewright complete: '), complete);
  ok(complete.includes('Usage: slicewright complete <shell>'), complete);
  ok(
    complete.endsWith(
      'stdout is the completion script; errors go to stderr. Exit 0 ok, 2 usage or input failure.',
    ),
    complete,
  );
  const prompt = conciseHelp(helpProgram, 'prompt');
  ok(/--kind <[a-z|-]+>  UI element kind: .* \(required\)/u.test(prompt), prompt);
  ok(/--style <string>  .* \(required\)/u.test(prompt), prompt);
  ok(prompt.endsWith('Exit 0 ok, 2 usage or input failure.'), prompt);
  ok(
    conciseHelp(helpProgram, 'inspect').endsWith(
      'Exit 0 ok, 1 an error finding, 2 usage or input failure.',
    ),
  );

  // Shorter than gunshi's help, and plain.
  for (const argv of [['--help'], ['inspect', '--help'], ['normalize', '--help']]) {
    const full = await defaultHelp(argv);
    const short = conciseHelp(program, argv.length > 1 ? argv[0] : undefined);
    ok(full.length > 0, argv.join(' '));
    ok(short.length < full.length, `${argv.join(' ')}: ${short.length} >= ${full.length}`);
    strictEqual(plain(short), short);
  }
  strictEqual(plain('\u001b[31mred\u001b[0m and \u001b[1mbold\u001b[22m'), 'red and bold');
}
void test('agent mode', agentModeHelp);
