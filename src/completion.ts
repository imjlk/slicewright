/**
 * Shell completion through `@gunshi/plugin-completion`: `slicewright complete
 * <shell>` prints a script, and the script asks `slicewright complete -- <words>`
 * for candidates. This module supplies what the plugin cannot know on its own:
 * enum choices, export targets, command names, and file paths for the
 * arguments that take one.
 */
import { readdirSync } from 'node:fs';

/** One candidate the plugin prints: the value and an optional description. */
export interface Candidate {
  readonly value: string;
  readonly description?: string;
}

type Handler = () => Candidate[];

/** The plugin's per-command config: a handler per argument key. */
export interface CommandCompletion {
  readonly args: Record<string, { readonly handler: Handler }>;
}

/** The shells `complete <shell>` writes a script for. */
export const completionShells = ['bash', 'zsh', 'fish', 'powershell'] as const;

/** What a path argument accepts: files with these extensions, or directories only. */
export type PathKind = { readonly files: readonly string[] } | 'directory';

/** The argument definitions this module reads; a subset of gunshi's. */
export interface ArgShape {
  readonly type: string;
  readonly choices?: readonly string[] | undefined;
  readonly description?: string | undefined;
}

export interface CompletionSources {
  readonly commands: Readonly<Record<string, { readonly args?: Readonly<Record<string, ArgShape>> | undefined }>>;
  /** Path arguments by command, then by argument key. */
  readonly paths: Readonly<Record<string, Readonly<Record<string, PathKind>>>>;
  /** Comma-separated list arguments by command, then by argument key: the names they take. */
  readonly lists: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
  /** Arguments whose values are command names, by command. */
  readonly commandNames: Readonly<Record<string, string>>;
  /** The word being completed; the last word on the command line. */
  readonly word: () => string;
}

/**
 * Candidates for a path: the entries of the directory the word names that
 * start with what follows its last separator, directories with a trailing `/`
 * and files with one of the extensions. Hidden entries only for a word whose
 * name part starts with a dot. An unreadable directory has no candidates.
 */
export function pathCandidates(word: string, kind: PathKind): Candidate[] {
  const cut = Math.max(word.lastIndexOf('/'), word.lastIndexOf('\\')) + 1;
  const dir = word.slice(0, cut);
  const base = word.slice(cut);
  let entries;
  try {
    entries = readdirSync(dir === '' ? '.' : dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: Candidate[] = [];
  for (const entry of entries) {
    if (!entry.name.startsWith(base) || (entry.name.startsWith('.') && !base.startsWith('.'))) {
      continue;
    }
    if (entry.isDirectory()) {
      out.push({ value: `${dir}${entry.name}/` });
    } else if (
      kind !== 'directory' &&
      (kind.files.length === 0 ||
        kind.files.some((ext) => entry.name.toLowerCase().endsWith(ext)))
    ) {
      out.push({ value: `${dir}${entry.name}` });
    }
  }
  return out.sort((a, b) => a.value.localeCompare(b.value));
}

/**
 * Candidates for a comma-separated list: the names not yet in the list,
 * each after the part the word already holds.
 */
export function listCandidates(word: string, names: readonly string[]): Candidate[] {
  const cut = word.lastIndexOf(',') + 1;
  const head = word.slice(0, cut);
  const taken = new Set(head.split(',').filter((name) => name !== ''));
  return names.filter((name) => !taken.has(name)).map((name) => ({ value: `${head}${name}` }));
}

/**
 * The plugin config for every command: enum choices, list values, command
 * names, and paths. Arguments not covered get no candidates.
 *
 * @evidence docs/spec.md#shell-completion Completes enum choices, comma-separated targets, command names, and file or directory paths by argument.
 * @evidenceReview docs/spec.md#shell-completion #eaca858 Read the section's rules for choices, targets, command names, and paths, and ran the completion tests with pnpm test.
 */
export function completionConfig(sources: CompletionSources): Record<string, CommandCompletion> {
  const config: Record<string, CommandCompletion> = {};
  for (const [name, command] of Object.entries(sources.commands)) {
    const args: Record<string, { handler: Handler }> = {};
    for (const [key, arg] of Object.entries(command.args ?? {})) {
      const path = sources.paths[name]?.[key];
      const list = sources.lists[name]?.[key];
      if (path !== undefined) {
        args[key] = { handler: () => pathCandidates(sources.word(), path) };
      } else if (list !== undefined) {
        args[key] = { handler: () => listCandidates(sources.word(), list) };
      } else if (sources.commandNames[name] === key) {
        args[key] = {
          handler: () =>
            Object.entries(sources.commands).map(([value]) => ({ value })),
        };
      } else if (arg.type === 'enum' && arg.choices !== undefined) {
        const choices = arg.choices;
        args[key] = { handler: () => choices.map((value) => ({ value })) };
      }
    }
    config[name] = { args };
  }
  return config;
}

/**
 * Why `complete` cannot run with these arguments, or undefined when it can:
 * it takes one of the shells, or `--` and the words to complete.
 */
export function completeUsageProblem(argv: readonly string[]): string | undefined {
  if (argv[0] !== 'complete') {
    return undefined;
  }
  const shell = argv[1];
  if (shell === '--' || (shell !== undefined && (completionShells as readonly string[]).includes(shell) && argv.length === 2)) {
    return undefined;
  }
  if (shell === '-h' || shell === '--help') {
    return undefined;
  }
  return shell === undefined
    ? `complete needs a shell: ${completionShells.join(', ')}. For example: slicewright complete bash`
    : (completionShells as readonly string[]).includes(shell)
      ? `complete takes one shell, not "${argv.slice(1).join(' ')}".`
      : `Unknown shell "${shell}". Shells: ${completionShells.join(', ')}.`;
}
