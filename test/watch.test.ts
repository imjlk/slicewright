import { ok, strictEqual } from 'node:assert/strict';
import fs, {
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock, test } from 'node:test';

import { watchRuns } from '../src/watch.js';

async function until(check: () => boolean, timeout = 5000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) {
      throw new Error('Timed out waiting for a watched run.');
    }
    await new Promise((done) => setTimeout(done, 50));
  }
}

/**
 * @evidence docs/spec.md#watching Runs again on a change, keeps watching after a throw, prints the label with the error, and ends with the last run's status.
 * @evidenceReview docs/spec.md#watching #cced350 Read the updated contract and existing actual-watch change/error/last-status assertions; kept the five-second failure deadline unchanged.
 */
export async function watchesInputs(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'slicewright-watch-'));
  const input = join(dir, 'art.txt');
  writeFileSync(input, 'ok');
  const lines: unknown[] = [];
  const controller = new AbortController();
  try {
    const done = watchRuns(
      [input],
      { image: input },
      (record) => {
        record([input]);
        const text = readFileSync(input, 'utf8');
        if (text === 'throw') {
          throw new Error('bad input');
        }
        return { status: text === 'ok' ? 'ok' : 'failed', value: { text } };
      },
      (value) => lines.push(value),
      controller.signal,
    );
    strictEqual(lines.length, 1);
    // A save can produce an extra successful run before the next input change.
    writeFileSync(input, 'ok');
    await until(() => lines.length >= 2);
    const beforeThrow = lines.length;
    writeFileSync(input, 'throw');
    let errorIndex = -1;
    await until(() => {
      errorIndex = lines.findIndex(
        (value, index) =>
          index >= beforeThrow && (value as { error?: string }).error === 'bad input',
      );
      return errorIndex !== -1;
    });
    const errored = lines[errorIndex] as { image?: string; ok?: boolean; error?: string };
    strictEqual(errored.image, input);
    strictEqual(errored.ok, false);
    strictEqual(errored.error, 'bad input');
    writeFileSync(input, 'nope');
    await until(() => (lines.at(-1) as { text?: string }).text === 'nope');
    controller.abort();
    strictEqual(await done, 'failed');
    ok(lines.length >= 4);
  } finally {
    controller.abort();
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * A run that aborts from inside still ends the watch with that run's status.
 */
export async function abortsFromRun(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'slicewright-watch-abort-'));
  const input = join(dir, 'art.txt');
  writeFileSync(input, 'ok');
  const controller = new AbortController();
  let runs = 0;
  try {
    const done = watchRuns(
      [input],
      {},
      (record) => {
        record([input]);
        runs += 1;
        if (runs === 1) {
          return { status: 'ok', value: {} };
        }
        controller.abort();
        return { status: 'failed', value: {} };
      },
      () => undefined,
      controller.signal,
    );
    writeFileSync(input, 'changed');
    strictEqual(await done, 'failed');
  } finally {
    controller.abort();
    rmSync(dir, { recursive: true, force: true });
  }
}

void test('watching', watchesInputs);
void test('watch aborted from a run', abortsFromRun);

/**
 * @evidence docs/spec.md#watching Suppresses all native notifications and checks startup saves, preserved-time replacements, idle behavior, error recovery and abort cleanup through metadata polling.
 * @evidenceReview docs/spec.md#watching #cced350 Ran 55 unit tests and the focused notification-suppression regression successfully, including exactly preserved mtime, idle inputs and stopped timers; the built implementation recovered all 100 immediate macOS saves.
 */
export async function recoversLostWatchEvents(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'slicewright-watch-fallback-'));
  const input = join(dir, 'input.txt');
  writeFileSync(input, 'first');
  const controller = new AbortController();
  const lines: unknown[] = [];
  const nativeWatch = fs.watch;
  // Close native handles immediately to exercise the fallback on every OS.
  // Restore the built-in bindings in finally; node:test runs these tests serially.
  const suppressed = mock.method(fs, 'watch', (...args: Parameters<typeof fs.watch>) => {
    const watcher = nativeWatch(...args);
    watcher.close();
    return watcher;
  });
  syncBuiltinESMExports();
  try {
    const done = watchRuns(
      [input],
      {},
      (record) => {
        record([input]);
        const text = readFileSync(input, 'utf8');
        if (text === 'throw') {
          throw new Error('fallback failure');
        }
        return { status: 'ok', value: text };
      },
      (value) => lines.push(value),
      controller.signal,
    );
    writeFileSync(input, 'first');
    utimesSync(input, 1_000_000, 1_000_000);
    await until(() => lines.length === 2);
    const preserved = statSync(input).mtime;
    const replacement = join(dir, 'replacement.txt');
    writeFileSync(replacement, 'other');
    utimesSync(replacement, preserved, preserved);
    renameSync(replacement, input);
    strictEqual(statSync(input).mtimeMs, preserved.getTime());
    await until(() => lines.at(-1) === 'other');
    const idleCount = lines.length;
    await new Promise((done) => setTimeout(done, 600));
    strictEqual(lines.length, idleCount, 'Idle inputs must not rebuild on every poll.');
    writeFileSync(input, 'throw');
    await until(() => (lines.at(-1) as { error?: string }).error === 'fallback failure');
    writeFileSync(input, 'final');
    await until(() => lines.at(-1) === 'final');
    controller.abort();
    strictEqual(await done, 'ok');
    const stoppedCount = lines.length;
    writeFileSync(input, 'after');
    await new Promise((done) => setTimeout(done, 600));
    strictEqual(lines.length, stoppedCount, 'An aborted watch must never rebuild.');
  } finally {
    controller.abort();
    suppressed.mock.restore();
    syncBuiltinESMExports();
    rmSync(dir, { recursive: true, force: true });
  }
}

void test('watch recovers lost native notifications', recoversLostWatchEvents);
