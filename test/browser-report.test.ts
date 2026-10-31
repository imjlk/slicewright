import { deepStrictEqual, match, rejects, strictEqual } from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  checkSnapshot,
  writeBrowserArtifacts,
  writeBrowserReportHtml,
  type BrowserSnapshot,
} from '../src/browser.js';
import { encodePng } from '../src/png.js';
import { createRaster } from '../src/raster.js';

/**
 * @evidenceReview docs/spec.md#browser-html-reports #549a1e2 Read the relocation, hostile-text, corrupt-input, passing-outcome, symlink and exclusive-write assertions against the report contract.
 * @evidence docs/spec.md#browser-failure-context Tests rendering labels, malformed DPR, escaped hostile text and failed-negation HTML outcome.
 * @evidenceReview docs/spec.md#browser-failure-context #0d2038e Reviewed report rendering validation and the new false CLI outcome when a matching observation has an assertion failure.
 * @evidence docs/spec.md#browser-html-reports Tests portable fixed-path inputs, embedded images, hostile text escaping, corrupt JSON/geometry/PNG refusal and exclusive output creation without source mutation.
 */
export async function writesBrowserHtmlReports(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'slicewright-report-'));
  try {
    const source = join(directory, 'source');
    const hostile = '</script><img src="https://invalid.example/x" onerror="globalThis.injected=true">&';
    const actual: BrowserSnapshot = {
      rendering: {
        viewport: { width: 320, height: 200 },
        deviceScaleFactor: 2,
        runnerPlatform: 'test-runner',
        browser: { name: 'test-browser', version: '1' },
        labels: { fontSet: hostile },
      },
      measurement: {
        bounds: { x: 10, y: 20, width: 4, height: 3 },
        content: {
          label: { bounds: { x: 11, y: 21, width: 2, height: 1 }, text: hostile },
        },
      },
      clip: { x: 10, y: 20, width: 4, height: 3 },
      raster: createRaster(4, 3),
    };
    const reference = { ...actual, clip: { ...actual.clip, width: 5 }, raster: createRaster(5, 3) };
    await writeBrowserArtifacts(source, {
      actual,
      reference,
      changedFrom: actual,
      report: checkSnapshot(actual, { reference, text: { label: 'Safe' } }),
    });
    const before = await readFile(join(source, 'report.json'));
    const moved = join(directory, 'downloaded');
    await cp(source, moved, { recursive: true });
    await rm(source, { recursive: true });
    const output = join(directory, 'report.html');
    deepStrictEqual(await writeBrowserReportHtml(moved, output), { path: output, ok: false });
    const html = await readFile(output, 'utf8');
    strictEqual(html.includes(hostile), false);
    match(html, /\\u003c\/script\\u003e/);
    strictEqual((html.match(/data:image\/png;base64,/g) ?? []).length, 5);
    await rejects(writeBrowserReportHtml(moved, output), /EEXIST/);
    await rejects(writeBrowserReportHtml(moved, join(moved, 'report.json')), /EEXIST/);
    deepStrictEqual(await readFile(join(moved, 'report.json')), before);
    strictEqual(await readFile(output, 'utf8'), html);
    const parsed = JSON.parse(before.toString('utf8')) as { actual: { width: number } };
    parsed.actual.width = 50;
    await writeFile(join(moved, 'report.json'), JSON.stringify(parsed));
    await rejects(writeBrowserReportHtml(moved, join(directory, 'bad.html')), /dimensions/);
    await writeFile(join(moved, 'report.json'), '{}');
    await rejects(writeBrowserReportHtml(moved, join(directory, 'bad.html')));
    await writeFile(join(moved, 'report.json'), before);
    await writeFile(join(moved, 'actual.png'), encodePng(createRaster(1, 1)));
    await rejects(writeBrowserReportHtml(moved, join(directory, 'bad.html')), /dimensions/);
    await writeFile(join(moved, 'actual.png'), 'not png');
    await rejects(writeBrowserReportHtml(moved, join(directory, 'bad.html')), /PNG/);
    await rejects(readFile(join(directory, 'bad.html')), /ENOENT/);
    await writeBrowserArtifacts(moved, { actual, report: checkSnapshot(actual) });
    deepStrictEqual(await writeBrowserReportHtml(moved, join(directory, 'passing.html')), {
      path: join(directory, 'passing.html'),
      ok: true,
    });
    // A missing output folder is created; a missing or empty artifact folder is named.
    const nested = join(directory, 'reports', 'nested', 'passing.html');
    strictEqual((await writeBrowserReportHtml(moved, nested)).ok, true);
    const empty = join(directory, 'empty');
    await mkdir(empty);
    await rejects(
      writeBrowserReportHtml(empty, join(directory, 'none.html')),
      /has no report\.json; pass the failure artifact directory/,
    );
    await rejects(
      writeBrowserReportHtml(join(directory, 'missing'), join(directory, 'none.html')),
      /does not exist; pass the failure artifact directory/,
    );
    await rejects(readFile(join(directory, 'none.html')), /ENOENT/);
    await writeBrowserArtifacts(moved, {
      actual,
      report: checkSnapshot(actual),
      assertion: { matcher:'toMatchUI', negated:true, error:hostile },
    });
    strictEqual((await writeBrowserReportHtml(moved, join(directory, 'negated.html'))).ok, false);
    const failedHtml = await readFile(join(directory, 'negated.html'),'utf8');
    strictEqual(failedHtml.includes(hostile),false);
    match(failedHtml,/Assertion failed/);
    const invalid = {
      ...actual,
      rendering: { ...actual.rendering, deviceScaleFactor: 0 },
    } as BrowserSnapshot;
    await rejects(
      writeBrowserArtifacts(moved, { actual:invalid, report:checkSnapshot(actual) }),
      /positive/,
    );
    if (process.platform !== 'win32') {
      await rm(join(moved, 'actual.png'));
      const external = join(directory, 'external.png');
      await writeFile(external, encodePng(actual.raster));
      await symlink(external, join(moved, 'actual.png'));
      await rejects(writeBrowserReportHtml(moved, join(directory, 'symlink.html')), /regular file/);
    }

  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

void test('browser HTML reports', writesBrowserHtmlReports);
