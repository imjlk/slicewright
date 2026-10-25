import { existsSync, readlinkSync, realpathSync, statSync, watch, type FSWatcher } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { buildInputs, runBuild, type BuildManifest } from './build.js';

/** How the last build before the watch stopped went: passed, failed its findings, or errored. */
export type WatchStatus = 'ok' | 'failed' | 'error';

/**
 * Builds, then builds again whenever the manifest or a piece's input changes,
 * printing one JSON line per build, until interrupted. Directories are watched
 * rather than files, so an editor that replaces a file on save still counts.
 */
export function watchBuild(
  path: string,
  baseDir: string,
  load: (path: string) => BuildManifest,
  line: (value: unknown) => void,
): Promise<WatchStatus> {
  const watchers = new Map<string, FSWatcher>();
  let watched = new Set<string>([resolve(path)]);
  // Modification times at the last build, to tell a real change from an unnamed event.
  let seen = new Map<string, number>();
  let timer: NodeJS.Timeout | undefined;
  let status: WatchStatus = 'ok';
  const modified = (file: string): number => {
    try {
      return statSync(file).mtimeMs;
    } catch {
      return -1;
    }
  };
  const schedule = (): void => {
    clearTimeout(timer);
    // Editors write in bursts; build once they settle.
    timer = setTimeout(rebuild, 100);
  };
  const rebuild = (): void => {
    try {
      const manifest = load(path);
      watched = watchTargets(buildInputs(manifest, path));
      seen = new Map([...watched].map((file) => [file, modified(file)]));
      const report = runBuild(manifest, baseDir, process.cwd(), [path]);
      status = report.ok ? 'ok' : 'failed';
      line({ manifest: path, ...report });
    } catch (error) {
      status = 'error';
      seen = new Map([...watched].map((file) => [file, modified(file)]));
      line({
        manifest: path,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    // A missing directory is watched through its nearest existing ancestor, for
    // the one entry on the way down, until it exists.
    const targets = new Map<string, Set<string>>();
    for (const file of watched) {
      let directory = dirname(file);
      let entry = basename(file);
      while (!existsSync(directory) && dirname(directory) !== directory) {
        entry = basename(directory);
        directory = dirname(directory);
      }
      targets.set(directory, (targets.get(directory) ?? new Set()).add(join(directory, entry)));
    }
    for (const [directory, watcher] of watchers) {
      watcher.close();
      watchers.delete(directory);
    }
    for (const [directory, entries] of targets) {
      const identity = inode(directory);
      try {
        watchers.set(
          directory,
          watch(directory, (_event, file) => {
            if (inode(directory) !== identity) {
              // A directory replaced as a whole; rebuilding re-arms the watcher on the new one.
              schedule();
            } else if (file === null) {
              // Some platforms do not name the file; rebuild only when a watched one changed.
              if ([...watched].some((item) => (seen.get(item) ?? -1) !== modified(item))) {
                schedule();
              }
            } else if (entries.has(join(directory, file))) {
              schedule();
            }
          }),
        );
      } catch {
        // Unwatchable even after climbing; the next manifest change re-arms the watchers.
      }
    }
    // An input that changed while the build ran may have had its event dropped with the old watchers.
    if ([...watched].some((item) => (seen.get(item) ?? -1) !== modified(item))) {
      schedule();
    }
  };
  rebuild();
  return new Promise((done) => {
    process.once('SIGINT', () => {
      clearTimeout(timer);
      for (const watcher of watchers.values()) {
        watcher.close();
      }
      done(status);
    });
  });
}

/**
 * The paths, plus where each symlink among them points, so edits through
 * either rebuild. A dangling link adds each target along its chain, so the
 * file it will point at is watched before it exists.
 *
 * @evidence docs/spec.md#build-manifest Watches a symlinked input where the link is and where it points, and a dangling one where it will point.
 * @evidenceReview docs/spec.md#build-manifest #81ef4f6 Read the watch rules in the section against this function and ran followsDanglingSymlinks green with pnpm test.
 */
export function watchTargets(paths: readonly string[]): Set<string> {
  const all = new Set(paths);
  for (const path of paths) {
    try {
      all.add(realpathSync(path));
    } catch {
      for (const target of linkChain(path)) {
        all.add(target);
      }
    }
  }
  return all;
}

/**
 * Where a path leads when a link in it, at any component, dangles: each
 * rewrite of the first link found, with the rest of the path appended.
 */
function linkChain(path: string): string[] {
  const chain: string[] = [];
  let current = resolve(path);
  for (let depth = 0; depth < 40; depth += 1) {
    const next = rewriteFirstLink(current);
    if (next === undefined) {
      break;
    }
    chain.push(next);
    current = next;
  }
  return chain;
}

function rewriteFirstLink(path: string): string | undefined {
  const parts: string[] = [];
  for (let prefix = path; ; prefix = dirname(prefix)) {
    try {
      return join(resolve(dirname(prefix), readlinkSync(prefix)), ...parts.reverse());
    } catch {
      // Not a link, or missing: try the parent.
    }
    if (dirname(prefix) === prefix) {
      return undefined;
    }
    parts.push(basename(prefix));
  }
}

/** A directory's inode, to tell a replaced directory from the one being watched. */
function inode(path: string): bigint {
  try {
    return statSync(path, { bigint: true }).ino;
  } catch {
    return -1n;
  }
}
