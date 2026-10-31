import { ok, strictEqual, throws } from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { test } from 'node:test';

import { relativeUrl, writeOutputFile } from '../src/output-paths.js';
import { loadPlaywrightTest } from '../src/playwright.js';

/**
 * @evidence docs/spec.md#output-files Writes into folders that do not exist yet and refuses relative references across Windows drives.
 * @evidenceReview docs/spec.md#output-files #e0e2798 Checked the assertions against the section and ran this test green with pnpm test.
 */
export async function writesOutputFilesAndReferences(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'slicewright-output-'));
  try {
    const nested = join(directory, 'missing', 'deeper', 'panel.json');
    writeOutputFile(nested, '{}');
    strictEqual(await readFile(nested, 'utf8'), '{}');
    writeOutputFile(nested, '[]');
    strictEqual(await readFile(nested, 'utf8'), '[]');
    throws(() => writeOutputFile(nested, '{}', { exclusive: true }), /EEXIST/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  strictEqual(relativeUrl('/game/ui', '/game/art/panel.png', posix), '../art/panel.png');
  strictEqual(relativeUrl('/game/ui', '/game/ui/panel.png', posix), 'panel.png');
  strictEqual(relativeUrl('C:\\game\\ui', 'C:\\game\\art\\panel.png', win32), '../art/panel.png');
  strictEqual(relativeUrl('C:\\game\\ui', 'D:\\art\\panel.png', win32), undefined);
  strictEqual(relativeUrl('C:\\game', '\\\\server\\share\\panel.png', win32), undefined);
}

/**
 * @evidence docs/spec.md#playwright-test-integration Names the install command when the optional @playwright/test peer is missing and passes other load failures through.
 * @evidenceReview docs/spec.md#playwright-test-integration #d4f3a85 Re-read the section after the missing-peer sentence, checked the assertions against it, and ran this test green.
 */
export function explainsMissingPlaywrightTest(): void {
  const missing = (): never => {
    throw Object.assign(new Error("Cannot find module '@playwright/test'"), {
      code: 'MODULE_NOT_FOUND',
    });
  };
  throws(
    () => loadPlaywrightTest(missing),
    /needs the optional peer @playwright\/test.*npm install --save-dev @playwright\/test playwright-core/,
  );
  const broken = new SyntaxError('broken install');
  throws(
    () =>
      loadPlaywrightTest(() => {
        throw broken;
      }),
    (error) => error === broken,
  );
  ok(typeof loadPlaywrightTest().expect === 'function');
}

void test('output files', writesOutputFilesAndReferences);
void test('missing Playwright Test', explainsMissingPlaywrightTest);
