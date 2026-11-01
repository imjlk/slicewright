/**
 * The machine-readable command catalog that `slicewright commands` prints. It
 * reads the same command definitions the argument parser runs, through plain
 * fields every gunshi version keeps (`args`, `description`, `examples`), so
 * the catalog cannot drift from the CLI.
 */

/** One argument as a command definition declares it. */
export interface ArgDefinition {
  readonly type: string;
  readonly description?: string | undefined;
  readonly default?: unknown;
  readonly choices?: readonly string[] | undefined;
  readonly required?: boolean | undefined;
  readonly multiple?: boolean | undefined;
  readonly negatable?: boolean | undefined;
  readonly short?: string | undefined;
}

/** The parts of a command definition the catalog reads. */
export interface CommandDefinition {
  readonly description?: string | undefined;
  readonly examples?: unknown;
  readonly args?: Readonly<Record<string, ArgDefinition>> | undefined;
}

/** Exit status codes every command uses, by code. */
export const exitCodeMeanings = {
  0: 'ok',
  1: 'an error finding (the JSON report says which)',
  2: 'usage or input failure (message on stderr)',
} as const;

export type ExitCode = keyof typeof exitCodeMeanings;

/** What the catalog needs to know about the program. */
export interface CatalogSource {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly commands: Readonly<Record<string, CommandDefinition>>;
  /** The exit codes each command can end with, by command name. */
  readonly exits: Readonly<Record<string, readonly ExitCode[]>>;
  /** Second names of flags, by command, then alias, to the flag they stand for. */
  readonly aliases: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /**
   * Flags a command's handler insists on although the parser does not, by
   * command; the catalog lists them as required.
   */
  readonly requiredInRun?: Readonly<Record<string, readonly string[]>> | undefined;
}

export interface CatalogOption {
  /** The flag as typed, such as `--tolerance`. */
  readonly name: string;
  /** The key in the command's values, such as `tolerance`. */
  readonly key: string;
  readonly type: string;
  readonly required: boolean;
  readonly default: unknown;
  readonly choices: readonly string[] | null;
  readonly description: string;
  /** True when `--no-<key>` turns the flag off. */
  readonly negatable: boolean;
  /** A one-letter alias such as `-o`, when the flag has one. */
  readonly short: string | null;
  /** The flag this one is a second name for, such as `--keep` for `--keep-below`. */
  readonly aliasOf: string | null;
  /** The second names of this flag. */
  readonly aliases: readonly string[];
}

export interface CatalogArgument {
  readonly name: string;
  readonly required: boolean;
  readonly multiple: boolean;
  readonly description: string;
}

export interface CatalogCommand {
  readonly name: string;
  readonly description: string;
  readonly usage: string;
  readonly arguments: readonly CatalogArgument[];
  readonly options: readonly CatalogOption[];
  readonly exitCodes: readonly ExitCode[];
  readonly examples: readonly string[];
}

export interface CommandCatalog {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly output: string;
  readonly exitCodes: typeof exitCodeMeanings;
  readonly commands: readonly CatalogCommand[];
}

/**
 * Describes every command, or only `only`, with its arguments, its options
 * (type, default, choices, required, negatable, short and second names), the
 * exit codes it can end with, and its examples.
 *
 * @evidence docs/spec.md#command-catalog Builds the catalog from the command definitions themselves: every argument and option with its type, default, choices, required, negatable, short and second names, plus exit codes and examples.
 * @evidenceReview docs/spec.md#command-catalog #01e13b8 Reread the section after complete joined the catalog with its script output note, checked this host against it, and ran pnpm test green.
 */
export function describeCommands(source: CatalogSource, only?: string): CommandCatalog {
  const names = Object.keys(source.commands).filter((name) => only === undefined || name === only);
  return {
    name: source.name,
    version: source.version,
    description: source.description,
    output:
      'Every command but complete prints one JSON document on stdout; with --watch, one JSON line per run. complete prints a shell completion script. Usage errors go to stderr.',
    exitCodes: exitCodeMeanings,
    commands: names.map((name) =>
      describeCommand(
        source.name,
        name,
        source.commands[name] ?? {},
        source.exits[name] ?? [0, 2],
        source.aliases[name] ?? {},
        source.requiredInRun?.[name] ?? [],
      ),
    ),
  };
}

function describeCommand(
  program: string,
  name: string,
  command: CommandDefinition,
  exits: readonly ExitCode[],
  aliases: Readonly<Record<string, string>>,
  requiredInRun: readonly string[],
): CatalogCommand {
  const entries = Object.entries(command.args ?? {});
  const positionals = entries.filter(([, arg]) => arg.type === 'positional');
  const options = entries.filter(([, arg]) => arg.type !== 'positional');
  const args: CatalogArgument[] = positionals.map(([key, arg]) => ({
    name: key,
    required: positionalRequired(arg),
    multiple: arg.multiple === true,
    description: arg.description ?? '',
  }));
  const usage = [
    `${program} ${name}`,
    ...(options.length === 0 ? [] : ['[options]']),
    ...args.map((arg) => {
      const shown = arg.multiple ? `<${arg.name}...>` : `<${arg.name}>`;
      return arg.required ? shown : `[${shown}]`;
    }),
  ].join(' ');
  return {
    name,
    description: command.description ?? '',
    usage,
    arguments: args,
    options: options.map(([key, arg]) => ({
      name: `--${key}`,
      key,
      type: arg.type,
      required: arg.required === true || requiredInRun.includes(key),
      default: arg.default ?? null,
      choices: arg.choices === undefined ? null : [...arg.choices],
      description: arg.description ?? '',
      negatable: arg.negatable === true,
      short: arg.short === undefined ? null : `-${arg.short}`,
      aliasOf: aliases[key] === undefined ? null : `--${aliases[key]}`,
      aliases: Object.entries(aliases)
        .filter(([, target]) => target === key)
        .map(([alias]) => `--${alias}`),
    })),
    exitCodes: exits,
    examples: exampleLines(command.examples),
  };
}

/**
 * The parser's rule: a single positional is required unless it says
 * `required: false` or has a default; a repeated one only when it says so.
 */
function positionalRequired(arg: ArgDefinition): boolean {
  if (arg.required !== undefined || arg.multiple === true) {
    return arg.required === true;
  }
  return arg.default === undefined || arg.default === null;
}

/** Example command lines; `#` comments describe the next lines and are dropped. */
function exampleLines(examples: unknown): string[] {
  if (typeof examples !== 'string') {
    return [];
  }
  return examples
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}
