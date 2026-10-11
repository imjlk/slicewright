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
 * @evidenceReview docs/spec.md#command-line-arguments #f243c46 Checked this code against the section line by line and ran joinsNegativeNumbers green with pnpm test.
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
