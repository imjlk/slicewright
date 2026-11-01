/**
 * Agent mode: when an AI coding agent runs the CLI, help is shorter and plain.
 * Detection is gunshi's `getAgentProfile()` (std-env underneath), which a
 * non-empty `AI_AGENT` forces on; `SLICEWRIGHT_AGENT` turns it on or off
 * whatever was detected.
 */
import { stripVTControlCharacters } from 'node:util';

/** What `getAgentProfile()` reports; only the fields read here. */
export interface DetectedAgent {
  readonly isAgent: boolean;
  readonly name?: string | undefined;
}

export interface AgentMode {
  readonly on: boolean;
  /** The agent's name when one was detected or given through `AI_AGENT`. */
  readonly name: string | null;
  /** What decided: the slicewright override or detection. */
  readonly source: 'SLICEWRIGHT_AGENT' | 'detected';
}

/**
 * Agent mode from the detected profile and the environment. `SLICEWRIGHT_AGENT`
 * set to `1`/`true` forces it on and `0`/`false` forces it off; anything else
 * leaves the detection (including `AI_AGENT=<name>`) in charge.
 *
 * @evidence docs/spec.md#agent-mode Decides agent mode from gunshi's detected profile, with SLICEWRIGHT_AGENT=1/true and 0/false overriding it either way.
 * @evidenceReview docs/spec.md#agent-mode #041b6fe Reread the section after the handler-required options, per-command exit codes, and complete edits, checked this host against it, and ran pnpm test green.
 */
export function agentMode(
  detected: DetectedAgent,
  env: Readonly<Record<string, string | undefined>>,
): AgentMode {
  const name = detected.isAgent && detected.name !== undefined ? detected.name : null;
  const override = env['SLICEWRIGHT_AGENT']?.trim().toLowerCase();
  if (override === '1' || override === 'true') {
    return { on: true, name, source: 'SLICEWRIGHT_AGENT' };
  }
  if (override === '0' || override === 'false') {
    return { on: false, name, source: 'SLICEWRIGHT_AGENT' };
  }
  return { on: detected.isAgent, name, source: 'detected' };
}

/** One argument as a command definition declares it; only the fields help reads. */
export interface HelpArg {
  readonly type: string;
  readonly description?: string | undefined;
  readonly default?: unknown;
  readonly choices?: readonly string[] | undefined;
  readonly required?: boolean | undefined;
  readonly multiple?: boolean | undefined;
  readonly negatable?: boolean | undefined;
  readonly short?: string | undefined;
}

export interface HelpCommand {
  readonly description?: string | undefined;
  readonly examples?: unknown;
  readonly args?: Readonly<Record<string, HelpArg>> | undefined;
}

export interface HelpProgram {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly commands: Readonly<Record<string, HelpCommand>>;
  /** Flags a command's handler insists on although the parser does not, by command. */
  readonly requiredInRun?: Readonly<Record<string, readonly string[]>> | undefined;
  /** The exit codes each command can end with, by command; 0, 1, and 2 when not listed. */
  readonly exits?: Readonly<Record<string, readonly number[]>> | undefined;
  /** Commands whose stdout is not JSON, with what it is instead. */
  readonly stdout?: Readonly<Record<string, string>> | undefined;
}

const exitMeanings: Readonly<Record<number, string>> = {
  0: 'ok',
  1: 'an error finding',
  2: 'usage or input failure',
};

/** The closing note: what stdout carries and the exit codes `commandName` can end with. */
function outputNote(program: HelpProgram, commandName?: string): string {
  const stdout =
    commandName === undefined ? undefined : program.stdout?.[commandName];
  const codes = (commandName === undefined ? undefined : program.exits?.[commandName]) ?? [0, 1, 2];
  return `${stdout === undefined ? 'stdout is JSON only' : `stdout is ${stdout}`}; errors go to stderr. Exit ${codes
    .map((code) => `${String(code)} ${exitMeanings[code] ?? ''}`.trim())
    .join(', ')}.`;
}

/**
 * Short, plain help for agents, built from the command definitions: one line
 * per command for the program, or one line per argument and option for a
 * command, then its examples. No color, banner, or `-h`/`-v` rows.
 *
 * @evidence docs/spec.md#agent-mode Renders the concise agent help from the definitions: a line per command, or usage, a line per argument and option with type, default, choices, and --[no-] form, then examples, all without ANSI codes.
 * @evidenceReview docs/spec.md#agent-mode #041b6fe Reread the section after the handler-required options, per-command exit codes, and complete edits, checked this host against it, and ran pnpm test green.
 */
export function conciseHelp(program: HelpProgram, commandName?: string): string {
  const command =
    commandName !== undefined && Object.hasOwn(program.commands, commandName)
      ? program.commands[commandName]
      : undefined;
  if (commandName === undefined || command === undefined) {
    const names = Object.keys(program.commands);
    const width = Math.max(...names.map((name) => name.length));
    return plain(
      [
        `${program.name} ${program.version}: ${program.description}`,
        `Usage: ${program.name} <command> [options]`,
        'Commands:',
        ...names.map(
          (name) => `  ${name.padEnd(width)}  ${program.commands[name]?.description ?? ''}`,
        ),
        `Run ${program.name} <command> --help for its options.`,
        outputNote(program),
      ].join('\n'),
    );
  }
  const entries = Object.entries(command.args ?? {});
  const positionals = entries.filter(([, arg]) => arg.type === 'positional');
  const options = entries.filter(([, arg]) => arg.type !== 'positional');
  const usage = [
    `${program.name} ${commandName}`,
    ...(options.length === 0 ? [] : ['[options]']),
    ...positionals.map(([key, arg]) => {
      const shown = arg.multiple === true ? `<${key}...>` : `<${key}>`;
      return positionalRequired(arg) ? shown : `[${shown}]`;
    }),
  ].join(' ');
  const examples = exampleLines(command.examples);
  return plain(
    [
      `${program.name} ${commandName}: ${command.description ?? ''}`,
      `Usage: ${usage}`,
      ...(positionals.length === 0
        ? []
        : ['Arguments:', ...positionals.map(([key, arg]) => `  <${key}>  ${arg.description ?? ''}`)]),
      ...(options.length === 0
        ? []
        : [
            'Options:',
            ...options.map(
              ([key, arg]) =>
                `  ${optionLine(key, arg, program.requiredInRun?.[commandName]?.includes(key) === true)}`,
            ),
          ]),
      ...(examples.length === 0 ? [] : ['Examples:', ...examples.map((line) => `  ${line}`)]),
      outputNote(program, commandName),
    ].join('\n'),
  );
}

/**
 * `text` without ANSI escape codes, for output an agent reads.
 *
 * @evidence docs/spec.md#agent-mode Strips ANSI escape codes from help and stderr messages in agent mode.
 * @evidenceReview docs/spec.md#agent-mode #041b6fe Reread the section after the handler-required options, per-command exit codes, and complete edits, checked this host against it, and ran pnpm test green.
 */
export function plain(text: string): string {
  return stripVTControlCharacters(text);
}

function optionLine(key: string, arg: HelpArg, requiredInRun: boolean): string {
  const flag = arg.negatable === true ? `--[no-]${key}` : `--${key}`;
  const short = arg.short === undefined ? '' : `-${arg.short}, `;
  const value =
    arg.type === 'boolean'
      ? ''
      : arg.type === 'enum' && arg.choices !== undefined
        ? ` <${arg.choices.join('|')}>`
        : ` <${arg.type}>`;
  const notes = [
    ...(arg.required === true || requiredInRun ? ['required'] : []),
    ...(arg.default === undefined || arg.default === null
      ? []
      : [`default: ${String(arg.default)}`]),
  ];
  const description = arg.description ?? '';
  return `${short}${flag}${value}  ${description}${notes.length === 0 ? '' : ` (${notes.join(', ')})`}`;
}

/**
 * The parser's rule: a single positional is required unless it says
 * `required: false` or has a default; a repeated one only when it says so.
 */
function positionalRequired(arg: HelpArg): boolean {
  if (arg.required !== undefined || arg.multiple === true) {
    return arg.required === true;
  }
  return arg.default === undefined || arg.default === null;
}

/** Example command lines; `#` comments are dropped. */
function exampleLines(examples: unknown): string[] {
  if (typeof examples !== 'string') {
    return [];
  }
  return examples
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}
