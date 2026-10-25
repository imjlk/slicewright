import { existsSync, readlinkSync, realpathSync, statSync, watch, type FSWatcher } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { buildInputs, runBuild, type BuildManifest } from './build.js';

/** How the last build before the watch stopped went: passed, failed its findings, or errored. */
export type WatchStatus = 'ok' | 'failed' | 'error';

/** One run of a watched command: how it went, and the line to print. */
export interface WatchRun {
  readonly status: Exclude<WatchStatus, 'error'>;
  readonly value: unknown;
}

/**
 * Builds, then builds again whenever the manifest or a piece's input changes,
 * printing one JSON line per build, until interrupted.
 */
export function watchBuild(
  path: string,
  baseDir: string,
  load: (path: string) => BuildManifest,
  line: (value: unknown) => void,
): Promise<WatchStatus> {
  return watchRuns(
    [path],
    { manifest: path },
    (record) => {
      const manifest = load(path);
      record(buildInputs(manifest, path));
      const report = runBuild(manifest, baseDir, process.cwd(), [path]);
      return {
        status: report.ok ? 'ok' : 'failed',
        value: { manifest: path, ...report },
      };
    },
    line,
  );
}

/**
 * Runs a command, then again whenever a file it read changes, printing one
 * JSON line per run, until interrupted. `run` names the files it reads with
 * `record` before reading them, so a change while it runs starts another run
 * and a run that throws still watches them (the initial files until it first
 * records); a throw prints
 * `label` with `ok: false` and the error. Directories are watched rather than
 * files, so an editor that replaces a file on save still counts.
 *
 * @evidence docs/spec.md#watching Runs again when any input changes, keeps watching after a failed or erroring run, and ends with the last run's status.
 * @evidenceReview docs/spec.md#watching #2b98b4b Read the section against this function and ran watchesInputs green with pnpm test.
 */
export function watchRuns(
  initial: readonly string[],
  label: Readonly<Record<string, unknown>>,
  run: (record: (inputs: readonly string[]) => void) => WatchRun,
  line: (value: unknown) => void,
  /** Stops the watch like an interrupt; for tests and embedding. */
  signal?: AbortSignal,
): Promise<WatchStatus> {
  const watchers = new Map<string, FSWatcher>();
  let watched = new Set<string>(initial.map((file) => resolve(file)));
  // Modification times at the last build, to tell a real change from an unnamed event.
  let seen = new Map<string, number>();
  let timer: NodeJS.Timeout | undefined;
  let status: WatchStatus = 'ok';
  // Set once stopped, so a run that aborts from inside neither re-arms nor reschedules.
  let stopped = false;
  // While a run is in progress, an abort from inside it resolves only once its status is recorded.
  let running = false;
  let finish: ((value: WatchStatus) => void) | undefined;
  const modified = (file: string): number => {
    try {
      return statSync(file).mtimeMs;
    } catch {
      return -1;
    }
  };
  const schedule = (): void => {
    if (stopped) {
      return;
    }
    clearTimeout(timer);
    // Editors write in bursts; run once they settle.
    timer = setTimeout(rebuild, 100);
  };
  const rebuild = (): void => {
    const record = (inputs: readonly string[]): void => {
      watched = watchTargets(inputs.map((file) => resolve(file)));
      seen = new Map([...watched].map((file) => [file, modified(file)]));
    };
    running = true;
    try {
      const result = run(record);
      status = result.status;
      line(result.value);
    } catch (error) {
      status = 'error';
      seen = new Map([...watched].map((file) => [file, modified(file)]));
      line({ ...label, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    running = false;
    if (stopped) {
      finish?.(status);
      return;
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
    if (stopped) {
      return;
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
    const stop = (): void => {
      stopped = true;
      process.off('SIGINT', stop);
      signal?.removeEventListener('abort', stop);
      clearTimeout(timer);
      for (const watcher of watchers.values()) {
        watcher.close();
      }
      if (running) {
        finish = done;
      } else {
        done(status);
      }
    };
    process.once('SIGINT', stop);
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted === true) {
      stop();
    }
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
