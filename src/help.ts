/** What {@link tidyUsage} needs to know about the command whose help it tidies. */
export interface UsageTidying {
  /** True for the program's own help, which lists the commands. */
  readonly entry: boolean;
  /** Descriptions for `--no-<flag>`, by flag name, instead of the parser's "Negatable of". */
  readonly negated?: Readonly<Record<string, string>>;
  /** Option keys the command needs, marked `(required)` in its option rows. */
  readonly required?: readonly string[];
  /** The exit codes the command or program can end with and what each means, listed last. */
  readonly exitCodes?: ReadonlyArray<readonly [code: number, meaning: string]>;
}

const optionsPlaceholder = ' <OPTIONS>';

/**
 * Tidies the argument parser's help text: the program's help drops its own
 * `[slicewright] <OPTIONS>` row and the `<OPTIONS>` after every command, a
 * command's usage line reads `[options]` since no option is needed to name
 * the command, required options say `(required)`, negated flags get their own
 * description, `--help` and `--version` move to the end of the options so a
 * command's own options come first, and the exit codes close the help.
 *
 * @evidence docs/spec.md#command-line-arguments Lists commands without the program's own row, describes negated flags, and puts a command's own options before --help and --version.
 * @evidenceReview docs/spec.md#command-line-arguments #d7f096a Reread the section after the [options] usage line, (required) marker, and exit-code edit, checked this host against it, and ran pnpm test green.
 */
export function tidyUsage(text: string, tidying: UsageTidying): string {
  const lines = text.split('\n');
  const out: string[] = [];
  const common: string[] = [];
  let section = '';
  const flush = (): void => {
    out.push(...common);
    common.length = 0;
  };
  for (const line of lines) {
    const heading = /^([A-Z][A-Z ]*[A-Z]|For more info.*):$/u.exec(line);
    if (heading !== null) {
      flush();
      section = heading[1] ?? '';
      out.push(line);
      continue;
    }
    if (section === 'USAGE') {
      out.push(
        tidying.entry
          ? line.replace(/\[COMMANDS\] <OPTIONS>/u, '<command> [options]')
          : line.replace(optionsPlaceholder, ' [options]'),
      );
      continue;
    }
    if (tidying.entry && section === 'COMMANDS') {
      if (/^\s+\[[^\]]+\]/u.test(line)) {
        continue;
      }
      // Drop the placeholder but keep the description column where the parser put it.
      const row = /^(\s+)(\S(?:.*?\S)?)(\s{2,})(\S.*)$/u.exec(line);
      if (row === null) {
        out.push(line.replace(optionsPlaceholder, ''));
        continue;
      }
      const [, indent = '', usage = '', gap = '', description = ''] = row;
      out.push(
        `${indent}${usage.replace(optionsPlaceholder, '').padEnd(usage.length + gap.length)}${description}`,
      );
      continue;
    }
    if (tidying.entry && section.startsWith('For more info') && /^\s+\S+ --help$/u.test(line)) {
      // The program's own `--help` is the help being read.
      continue;
    }
    if (section === 'OPTIONS') {
      if (/^\s+-h, --help\s|^\s+-v, --version\s/u.test(line)) {
        common.push(line);
        continue;
      }
      if (line === '') {
        flush();
      }
      const negated = /^(\s+--no-([\w-]+)\s+)Negatable of --[\w-]+$/u.exec(line);
      const description = negated === null ? undefined : tidying.negated?.[negated[2] ?? ''];
      const flag = /^\s+(?:-\w, )?--([\w-]+)[\s=]/u.exec(line)?.[1];
      const required =
        negated === null && flag !== undefined && tidying.required?.includes(flag) === true;
      out.push(
        negated !== null && description !== undefined
          ? `${negated[1] ?? ''}${description}`
          : required
            ? `${line.trimEnd()} (required)`
            : line,
      );
      continue;
    }
    out.push(line);
  }
  flush();
  if (tidying.exitCodes !== undefined && tidying.exitCodes.length > 0) {
    while (out.length > 0 && out.at(-1)?.trim() === '') {
      out.pop();
    }
    out.push(
      '',
      'EXIT CODES:',
      ...tidying.exitCodes.map(([code, meaning]) => `  ${String(code)}  ${meaning}`),
      '',
    );
  }
  return out.join('\n');
}
