/** What {@link tidyUsage} needs to know about the command whose help it tidies. */
export interface UsageTidying {
  /** True for the program's own help, which lists the commands. */
  readonly entry: boolean;
  /** Descriptions for `--no-<flag>`, by flag name, instead of the parser's "Negatable of". */
  readonly negated?: Readonly<Record<string, string>>;
}

const optionsPlaceholder = ' <OPTIONS>';

/**
 * Tidies the argument parser's help text: the program's help drops its own
 * `[slicewright] <OPTIONS>` row and the `<OPTIONS>` after every command,
 * negated flags get their own description, and `--help` and `--version` move
 * to the end of the options so a command's own options come first.
 *
 * @evidence docs/spec.md#command-line-arguments Lists commands without the program's own row, describes negated flags, and puts a command's own options before --help and --version.
 * @evidenceReview docs/spec.md#command-line-arguments #f21cb56 Reread the section after the help-layout and targets-object edit, checked this code against it, and ran pnpm test green.
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
    if (tidying.entry && section === 'USAGE') {
      out.push(line.replace(/\[COMMANDS\] <OPTIONS>/u, '<command> [options]'));
      continue;
    }
    if (tidying.entry && section === 'COMMANDS') {
      if (/^\s+\[[^\]]+\]/u.test(line)) {
        continue;
      }
      // Keep the descriptions aligned: pad where the placeholder was.
      out.push(line.replace(optionsPlaceholder, ' '.repeat(optionsPlaceholder.length)));
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
      out.push(
        negated !== null && description !== undefined ? `${negated[1] ?? ''}${description}` : line,
      );
      continue;
    }
    out.push(line);
  }
  flush();
  return out.join('\n');
}
