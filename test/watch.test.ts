import { ok, strictEqual } from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

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
 * @evidenceReview docs/spec.md#watching #2b98b4b Checked the assertions against the section and ran this test green with pnpm test.
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
