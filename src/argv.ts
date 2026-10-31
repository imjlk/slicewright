/** A negative decimal number, as a command-line value. */
const negativeNumber = /^-(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * gunshi reads a negative number after a flag (`--tolerance -1`) as a short
 * option, so the flag is left without a value. This joins such a number to its
 * flag (`--tolerance=-1`) when the flag takes a number, so the command's own
 * validation sees the value. A number flag with nothing after it, or followed
 * by another option, would crash the parser the same way, so it throws a clear
 * error instead. Flags that already carry `=`, other flags, and everything
 * after `--` are left as they are.
 *
 * @evidence docs/spec.md#command-line-arguments Joins a negative number to the number flag before it, refuses a number flag without a value, and stops at a `--` terminator.
 * @evidenceReview docs/spec.md#command-line-arguments #07def6c Reread the section with the new flag-alias paragraph; this still covers the negative-number rules, which are unchanged, and the aliases are cited by aliasedValue/readsFlagAliases. Ran green with pnpm test.
 */
export function joinNegativeNumbers(
  argv: readonly string[],
  numberFlags: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';
    if (token === '--') {
      out.push(...argv.slice(index));
      break;
    }
    const next = argv[index + 1];
    if (numberFlags.has(token)) {
      if (next !== undefined && negativeNumber.test(next)) {
        out.push(`${token}=${next}`);
        index += 1;
        continue;
      }
      if (next === undefined || next.startsWith('-')) {
        throw new Error(`${token} needs a number${next === undefined ? '' : `, got ${next}`}.`);
      }
    }
    out.push(token);
  }
  return out;
}

/** A flag's value and whether the user typed it, as gunshi reports them. */
export interface AliasedFlags {
  readonly values: Readonly<Record<string, unknown>>;
  readonly explicit?: Readonly<Record<string, boolean | undefined>> | undefined;
}

/**
 * The value of a flag that also has a clearer second name. The second name
 * wins when only it is given; the original keeps its default otherwise. Giving
 * both names is refused, since one of the values would be silently dropped.
 *
 * @evidence docs/spec.md#command-line-arguments Reads a flag under either of its two names, keeps the original's default, and refuses both names at once.
 * @evidenceReview docs/spec.md#command-line-arguments #07def6c Checked against the flag-alias paragraph of the section (either name, original default kept, both refused) and ran readsFlagAliases green with pnpm test.
 */
export function aliasedValue<T>(flags: AliasedFlags, name: string, alias: string): T {
  const named = flags.explicit?.[name] === true;
  const aliased = flags.explicit?.[alias] === true;
  if (named && aliased) {
    throw new AliasClashError(`--${alias} is another name for --${name}; give only one of them.`);
  }
  return (aliased ? flags.values[alias] : flags.values[name]) as T;
}

/** Both names of one flag were given. */
export class AliasClashError extends Error {
  override name = 'AliasClashError';
}
