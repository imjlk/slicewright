import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { checkSnapshot, domTarget, writeBrowserArtifacts, writeBrowserReportHtml } from 'slicewright/browser';

export async function verifyHtmlReport(browser, output) {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  try {
    const page = await context.newPage();
    await page.setContent('<style>body{margin:0;background:#eee}button{margin:40px;width:260px;height:100px;border:4px solid #966326;border-radius:16px;background:#fff2ce;font:24px Georgia;color:#39220c}</style><button><span>Continue</span></button>');
    const target = domTarget(page, { root: page.locator('button'), content: { label: page.locator('span') } });
    const reference = await target.capture();
    await page.locator('button').evaluate(element => { element.style.borderColor = '#d12845'; });
    const actual = await target.capture();
    const hostile = '</script><img src="https://invalid.example/x" onerror="globalThis.injected=true">';
    const report = checkSnapshot(actual, { reference });
    await writeBrowserArtifacts(output, { actual, reference, changedFrom: reference, report: {
      ...report, findings: [...report.findings, { code: 'consumer.hostile-text', severity: 'info', message: hostile }],
    } });
    const original = await readFile(join(output, 'report.json'));
    // Paths in the original report refer to a producer machine, never the reader.
    const saved = JSON.parse(original);saved.artifacts.actual = '/nonexistent/producer/actual.png';
    await writeFile(join(output, 'report.json'), JSON.stringify(saved));
    const before = await readFile(join(output, 'report.json'));
    const html = join(output, 'viewer.html');
    strictEqual((await writeBrowserReportHtml(output, html)).ok, false);
    // Check the public CLI as an installed consumer, including JSON and status 1.
    let cli;
    try { await promisify(execFile)(process.execPath, [join(dirname(fileURLToPath(import.meta.resolve('slicewright/browser'))), 'cli.js'), 'browser-report', output, '--out', join(output, 'cli.html')]); }
    catch (error) { cli = error; }
    strictEqual(cli?.code, 1, cli?.stderr);
    strictEqual(JSON.parse(cli.stdout).ok, false);
    strictEqual(cli.stderr, '');
    const requests = [];
    const errors = [];
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(html).href);
    await page.locator('#tabs button').last().waitFor();
    strictEqual(await page.locator('#tabs button').count(), 5);
    strictEqual(await page.locator('#status').innerText(), 'Findings detected');
    ok((await page.locator('#findings').innerText()).includes(hostile));
    strictEqual(await page.evaluate(() => globalThis.injected), undefined);
    strictEqual(await page.locator('#regions .bounds').count() > 1, true);
    await page.getByRole('button', { name: 'expected', exact: true }).click();
    await page.locator('#blend').fill('50');
    strictEqual(await page.locator('#actual-overlay').evaluate(element => element.style.opacity), '0.5');
    await page.locator('#overlay').uncheck();
    strictEqual(await page.locator('#regions .bounds').count(), 0);
    await page.locator('#overlay').check();
    await page.getByRole('button', { name: 'diff', exact: true }).click();
    strictEqual(await page.locator('#regions .bounds').count(), 0);
    await page.getByRole('button', { name: 'actual', exact: true }).click();
    await page.locator('img#image').evaluate(image => image.decode());
    await page.screenshot({ path: join(output, 'viewer.png'), fullPage: true });
    deepStrictEqual(requests, []);deepStrictEqual(errors, []);
    deepStrictEqual(await readFile(join(output, 'report.json')), before);
    return true;
  } finally { await context.close(); }
}
