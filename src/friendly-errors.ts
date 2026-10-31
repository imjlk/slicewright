import { isArgsValidationError, isCommandNotFoundError } from 'gunshi';

import { schemaAt, type JsonSchema } from './manifest-schema.js';

/**
 * The closest of `candidates` to a misspelled `input`, by edit distance
 * (a swap of two neighbors counts as one edit), when it is close enough to
 * be a typo: at most a third of the longer word, and at least one edit.
 *
 * @evidence docs/spec.md#error-messages Suggests the closest known name within a third of its length, counting a transposition as one edit.
 * @evidenceReview docs/spec.md#error-messages #ed1adaa Checked this code against the section line by line and ran the error message tests green with pnpm test.
 */
export function didYouMean(input: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  const plain = input.toLowerCase();
  for (const candidate of candidates) {
    const distance = editDistance(plain, candidate.toLowerCase());
    const limit = Math.max(1, Math.floor(Math.max(plain.length, candidate.length) / 3));
    if (distance <= limit && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** Optimal string alignment distance: insertions, deletions, substitutions, and adjacent swaps. */
function editDistance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  const at = (i: number, j: number): number => rows[i]?.[j] ?? Infinity;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let distance = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        distance = Math.min(distance, at(i - 2, j - 2) + 1);
      }
      const row = rows[i];
      if (row !== undefined) {
        row[j] = distance;
      }
    }
  }
  return at(a.length, b.length);
}

/** What the CLI knows about the command a parse error came from. */
export interface CommandHelp {
  /** The subcommand, such as `normalize`; undefined for the bare program. */
  readonly command?: string | undefined;
  /** Every subcommand name, for an unknown command. */
  readonly commands: readonly string[];
}

/**
 * Rewrites the argument parser's validation errors into messages that name
 * the flag, what it takes, a likely intended name, and where to read more;
 * any other error keeps its own message.
 *
 * @evidence docs/spec.md#error-messages Rewrites a missing required flag or argument, an invalid choice or type, an unknown option and an unknown command into a message naming the fix, and keeps every other message.
 * @evidenceReview docs/spec.md#error-messages #ed1adaa Checked this code against the section line by line and ran the error message tests green with pnpm test.
 */
export function friendlyCliErrors(error: unknown, help: CommandHelp): string[] {
  const errors = error instanceof AggregateError ? (error.errors as unknown[]) : [error];
  const messages = errors.map((item) => friendlyCliError(item, help));
  // gunshi reports a missing value both as itself and as a type error; keep one.
  return [...new Set(messages)];
}

function friendlyCliError(error: unknown, help: CommandHelp): string {
  const seeHelp = `Run \`slicewright${help.command === undefined ? '' : ` ${help.command}`} --help\` for the options.`;
  if (isCommandNotFoundError(error) || (error instanceof Error && /^Command not found: /u.test(error.message))) {
    const name =
      isCommandNotFoundError(error)
        ? error.commandName
        : (error as Error).message.replace(/^Command not found: /u, '');
    const guess = didYouMean(name, help.commands);
    return `Unknown command "${name}".${guess === undefined ? '' : ` Did you mean ${guess}?`} Commands: ${help.commands.join(', ')}.`;
  }
  if (!isArgsValidationError(error)) {
    return error instanceof Error ? error.message : String(error);
  }
  const values = error.values as Record<string, unknown>;
  const flag = `--${String(values['name'] ?? '')}`;
  switch (error.code) {
    case 'err:arg:required-option':
      return `${help.command ?? 'slicewright'} needs ${flag} <value>. ${seeHelp}`;
    case 'err:arg:required-positional':
      return `${help.command ?? 'slicewright'} needs its <${String(values['name'] ?? 'input')}> argument. ${seeHelp}`;
    case 'err:arg:invalid-choice': {
      const choices = Array.isArray(values['choiceValues'])
        ? values['choiceValues'].map(String)
        : [];
      const actual = values['actual'];
      const guess = typeof actual === 'string' ? didYouMean(actual, choices) : undefined;
      return `${flag} must be one of ${choices.join(', ')}${typeof actual === 'string' ? `, not "${actual}"` : ''}.${guess === undefined ? '' : ` Did you mean ${flag} ${guess}?`}`;
    }
    case 'err:arg:invalid-type':
      return `${flag} takes a ${String(values['expected'] ?? 'value')}${typeof values['actual'] === 'string' ? `, not "${values['actual']}"` : ''}. ${seeHelp}`;
    case 'err:arg:unknown-option': {
      const raw = String(values['rawName'] ?? flag);
      const candidates = Array.isArray(values['candidates'])
        ? values['candidates'].map(String)
        : [];
      const guess = raw.startsWith('--') ? didYouMean(raw, candidates) : undefined;
      return `Unknown option ${raw}${help.command === undefined ? '' : ` for ${help.command}`}.${guess === undefined ? '' : ` Did you mean ${guess}?`} ${seeHelp}`;
    }
    default:
      return error.message;
  }
}

/** One problem typia found in a manifest. */
export interface ManifestIssue {
  /** typia's path, such as `$input.pieces[0].widht`. */
  readonly path: string;
  /** typia's expected type, such as `("area" | "nearest" | undefined)`. */
  readonly expected: string;
  readonly value: unknown;
}

/**
 * Explains manifest validation errors: an unknown key with the closest key
 * the schema allows there, a missing required key, a value outside its
 * choices with the choices, and anything else with what was expected.
 *
 * @evidence docs/spec.md#error-messages Explains an unknown manifest key with the closest allowed key, a missing key, a value outside its choices, and any other mismatch with what was expected.
 * @evidenceReview docs/spec.md#error-messages #ed1adaa Checked this code against the section line by line and ran the error message tests green with pnpm test.
 */
export function friendlyManifestIssues(issues: readonly ManifestIssue[], schema: JsonSchema): string[] {
  return issues.map((issue) => {
    const steps = pathSteps(issue.path);
    const where = steps.length === 0 ? 'The manifest' : formatPath(steps);
    const key = steps.at(-1);
    const parent = schemaAt(schema, steps.slice(0, -1));
    if (issue.expected === 'undefined' && typeof key === 'string') {
      const keys = Object.keys(parent?.properties ?? {});
      const guess = didYouMean(key, keys);
      const scope = steps.length === 1 ? 'the manifest' : formatPath(steps.slice(0, -1));
      return `${where} is not a key of ${scope}.${guess === undefined ? '' : ` Did you mean "${guess}"?`} Allowed: ${keys.join(', ')}.`;
    }
    const node = schemaAt(schema, steps);
    const expected = (node === undefined ? undefined : describeSchema(node)) ?? describe(issue.expected);
    if (issue.value === undefined) {
      return `${where} is required: ${expected}.`;
    }
    const choices = literalChoices(issue.expected);
    const shown = JSON.stringify(issue.value);
    if (choices !== undefined) {
      const guess = typeof issue.value === 'string' ? didYouMean(issue.value, choices) : undefined;
      return `${where} must be one of ${choices.map((choice) => JSON.stringify(choice)).join(', ')}, not ${shown}.${guess === undefined ? '' : ` Did you mean "${guess}"?`}`;
    }
    return `${where} must be ${expected}, not ${shown}.`;
  });
}

/** `$input.pieces[0].widht` as `['pieces', 0, 'widht']`; quoted keys keep their text. */
function pathSteps(path: string): (string | number)[] {
  const steps: (string | number)[] = [];
  const pattern = /\.([A-Za-z_$][\w$]*)|\[(\d+)\]|\[("(?:[^"\\]|\\.)*")\]/gu;
  for (const match of path.replace(/^\$input/u, '').matchAll(pattern)) {
    if (match[1] !== undefined) {
      steps.push(match[1]);
    } else if (match[2] !== undefined) {
      steps.push(Number(match[2]));
    } else if (match[3] !== undefined) {
      steps.push(JSON.parse(match[3]) as string);
    }
  }
  return steps;
}

function formatPath(steps: readonly (string | number)[]): string {
  return steps
    .map((step, index) =>
      typeof step === 'number'
        ? `[${step}]`
        : /^[A-Za-z_$][\w$]*$/u.test(step)
          ? `${index === 0 ? '' : '.'}${step}`
          : `[${JSON.stringify(step)}]`,
    )
    .join('');
}

/** `("area" | "nearest" | undefined)` as `['area', 'nearest']`; undefined when not all literals. */
function literalChoices(expected: string): string[] | undefined {
  const parts = expected
    .replace(/^\((.*)\)$/u, '$1')
    .split(' | ')
    .filter((part) => part !== 'undefined');
  if (parts.length === 0 || !parts.every((part) => /^"(?:[^"\\]|\\.)*"$/u.test(part))) {
    return undefined;
  }
  return parts.map((part) => JSON.parse(part) as string);
}

/** A schema node's type and limits in words, such as `a whole number, at least 1`. */
function describeSchema(node: JsonSchema): string | undefined {
  const kinds: Readonly<Record<string, string>> = {
    integer: 'a whole number',
    number: 'a number',
    string: 'a string',
    boolean: 'true or false',
    object: 'an object',
    array: node.items?.type === 'string' ? 'a list of strings' : 'a list',
  };
  const kind = node.type === undefined ? undefined : kinds[node.type];
  if (kind === undefined) {
    return undefined;
  }
  const limit = (key: string, words: string): string[] =>
    typeof node[key] === 'number' ? [`${words} ${String(node[key])}`] : [];
  return [
    kind,
    ...limit('minimum', 'at least'),
    ...limit('exclusiveMinimum', 'above'),
    ...limit('maximum', 'at most'),
    ...limit('exclusiveMaximum', 'below'),
    ...(typeof node['minItems'] === 'number' && node['minItems'] > 0
      ? [`with at least ${String(node['minItems'])} ${node['minItems'] === 1 ? 'entry' : 'entries'}`]
      : []),
  ].join(', ');
}

/** typia's expected type in words: `(number & Type<"uint32"> & Minimum<1>) | undefined` as `a whole number, at least 1`. */
function describe(expected: string): string {
  let type = expected.replace(/ \| undefined/gu, '');
  while (/^\(.*\)$/u.test(type)) {
    type = type.slice(1, -1);
  }
  const parts = type.split(' & ');
  const whole = parts.some((part) => /^Type<"u?int(?:32|64)">$/u.test(part));
  return parts
    .filter((part) => !(whole && part === 'number'))
    .map((part) => {
      const tag = /^(\w+)<(.*)>$/u.exec(part);
      const [name, argument] = tag === null ? [part, ''] : [tag[1] ?? '', tag[2] ?? ''];
      switch (name) {
        case 'Type':
          return 'a whole number';
        case 'Minimum':
          return `at least ${argument}`;
        case 'Maximum':
          return `at most ${argument}`;
        case 'ExclusiveMinimum':
          return `above ${argument}`;
        case 'ExclusiveMaximum':
          return `below ${argument}`;
        case 'MinItems':
          return `at least ${argument} ${argument === '1' ? 'entry' : 'entries'}`;
        case 'Array':
        case 'ReadonlyArray':
          return argument === 'string' ? 'a list of strings' : 'a list';
        case 'string':
        case 'number':
          return `a ${name}`;
        case 'boolean':
          return 'true or false';
        case 'BuildPiece':
          return 'a piece object';
        case 'BuildGroup':
          return 'a group object';
        default:
          return /^[A-Z]/u.test(name) ? 'an object' : part;
      }
    })
    .join(', ');
}
