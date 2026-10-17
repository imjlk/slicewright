import { existsSync, statSync, watch, type FSWatcher } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { buildInputs, runBuild, type BuildManifest } from './build.js';

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
): Promise<void> {
  const watchers = new Map<string, FSWatcher>();
  let watched = new Set<string>([resolve(path)]);
  // Modification times at the last build, to tell a real change from an unnamed event.
  let seen = new Map<string, number>();
  let timer: NodeJS.Timeout | undefined;
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
      watched = new Set(buildInputs(manifest, path));
      seen = new Map([...watched].map((file) => [file, modified(file)]));
      const report = runBuild(manifest, baseDir, process.cwd(), [path]);
      line({ manifest: path, ...report });
    } catch (error) {
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
      try {
        watchers.set(
          directory,
          watch(directory, (_event, file) => {
            if (file === null) {
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
  };
  rebuild();
  return new Promise((done) => {
    process.once('SIGINT', () => {
      clearTimeout(timer);
      for (const watcher of watchers.values()) {
        watcher.close();
      }
      done();
    });
  });
}
