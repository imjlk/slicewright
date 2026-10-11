/** A negative decimal number, as a command-line value. */
const negativeNumber = /^-(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * gunshi reads a negative number after a flag (`--tolerance -1`) as a short
 * option, so the flag is left without a value. This joins such a number to its
 * flag (`--tolerance=-1`) when the flag takes a number, so the command's own
 * validation sees the value. Flags that already carry `=`, other flags, and
 * everything after `--` are left as they are.
 *
 * @evidence docs/spec.md#command-line-arguments Joins a negative number to the number flag before it, outside a `--` terminator.
 * @evidenceReview docs/spec.md#command-line-arguments #57b0fed Checked this code against the section line by line and ran joinsNegativeNumbers green with pnpm test.
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
    if (numberFlags.has(token) && next !== undefined && negativeNumber.test(next)) {
      out.push(`${token}=${next}`);
      index += 1;
      continue;
    }
    out.push(token);
  }
  return out;
}
