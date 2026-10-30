import { deepStrictEqual, match, rejects, strictEqual } from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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
 * @evidence docs/spec.md#browser-html-reports Tests portable fixed-path inputs, embedded images, hostile text escaping, corrupt JSON/geometry/PNG refusal and exclusive output creation without source mutation.
 */
export async function writesBrowserHtmlReports(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'slicewright-report-'));
  try {
    const source = join(directory, 'source');
    const hostile = '</script><img src="https://invalid.example/x" onerror="globalThis.injected=true">&';
    const actual: BrowserSnapshot = {
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
