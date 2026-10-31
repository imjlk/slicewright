import { mkdirSync, writeFileSync } from 'node:fs';
import * as nodePath from 'node:path';

/** The parts of `node:path` a reference needs, so Windows paths can be checked anywhere. */
export type PathFlavor = Pick<typeof nodePath, 'relative' | 'resolve' | 'isAbsolute' | 'sep'>;

/**
 * Writes `contents` to `path`, creating its missing parent directories first,
 * so every command that writes a file accepts an output folder that does not
 * exist yet.
 *
 * @evidence docs/spec.md#output-files Creates missing parent directories before writing any output file.
 * @evidenceReview docs/spec.md#output-files #e0e2798 Checked this code against the section and ran writesOutputFilesAndReferences green with pnpm test.
 */
export function writeOutputFile(
  path: string,
  contents: string | Uint8Array,
  options: { readonly exclusive?: boolean } = {},
): void {
  mkdirSync(nodePath.dirname(nodePath.resolve(path)), { recursive: true });
  writeFileSync(path, contents, options.exclusive === true ? { flag: 'wx' } : undefined);
}

/**
 * `to` as a URL-style path relative to the directory `from`, with forward
 * slashes on every platform, or undefined when there is no relative path,
 * as between two Windows drives.
 *
 * @evidence docs/spec.md#output-files Refuses to invent a relative reference across Windows drives.
 * @evidenceReview docs/spec.md#output-files #e0e2798 Checked this code against the section and ran writesOutputFilesAndReferences green with pnpm test.
 */
export function relativeUrl(
  from: string,
  to: string,
  paths: PathFlavor = nodePath,
): string | undefined {
  const path = paths.relative(paths.resolve(from), paths.resolve(to));
  if (paths.isAbsolute(path) || /^[A-Za-z]:/.test(path)) {
    return undefined;
  }
  return path.split(paths.sep).join('/').replace(/\\/g, '/');
}
