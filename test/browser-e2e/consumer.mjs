import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { chromium } from 'playwright-core';
import {
  checkSnapshot, domTarget, regionTarget, saveBrowserBaseline, writeBrowserArtifacts,
} from 'slicewright/browser';

// This file runs from a newly installed consumer project. Its only product
// imports are public package exports, exactly as in an application's own test.
const directory = dirname(fileURLToPath(import.meta.url));
const execute = promisify(execFile);
const fixture = join(directory, 'fixture');
const output = process.argv[2];
ok(output, 'Supply an artifact output directory.');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = createServer((request, response) => {
  void (async () => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const file = resolve(fixture, `.${decodeURIComponent(pathname === '/' ? '/index.html' : pathname)}`);
    if (!file.startsWith(fixture + sep)) {
      response.writeHead(404).end();
      return;
    }
    try {
      const bytes = await readFile(file);
      response.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' });
      response.end(bytes);
    } catch {
      response.writeHead(404).end();
    }
  })().catch((error) => {
    response.writeHead(500).end(String(error));
  });
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const address = server.address();
ok(address && typeof address === 'object');
const base = `http://127.0.0.1:${address.port}`;
const cases = [];
let baselineRoundTrips = 0;
let browser;

async function restoreBaseline(path, environment, original) {
  await saveBrowserBaseline(path, original, { approved: true, environment });
  const { stdout } = await execute(process.execPath, [
    join(directory, 'baseline-loader.mjs'), path, environment,
  ], { cwd: directory, maxBuffer: 16 * 1024 * 1024, timeout: 30_000, windowsHide: true });
  const saved = JSON.parse(stdout);
  const restored = {
    measurement: saved.measurement,
    clip: saved.clip,
    raster: {
      width: saved.raster.width,
      height: saved.raster.height,
      data: new Uint8Array(Buffer.from(saved.raster.rgba, 'base64')),
    },
  };
  deepStrictEqual(restored, original, 'The public loader must restore measurements, clip, and every RGBA byte.');
  return restored;
}

async function checkPositionedCapture(position) {
  const context = await browser.newContext({
    viewport: { width: 640, height: 480 }, deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  try {
    await page.setContent(`<style>
      body { margin: 0; min-height: 3000px; }
      #target { position: ${position}; top: 20.5px; left: 13.25px;
        ${position === 'sticky' ? 'margin-left: 13.25px;' : ''}
        width: 125.5px; height: 84.25px; background: rgb(255, 0, 0); }
      </style><div style="height:400px"></div><div id="target"></div>`);
    await page.evaluate(() => window.scrollTo(0, 800));
    await settled(page);
    const target = domTarget(page, { root: page.locator('#target') });
    const before = await target.capture();
    deepStrictEqual(before.clip, { x: 13, y: 20, width: 126, height: 85 },
      `${position}: capture must enclose the fractional viewport CSS rectangle`);
    const center = (Math.floor(before.raster.height / 2) * before.raster.width +
      Math.floor(before.raster.width / 2)) * 4;
    deepStrictEqual(Array.from(before.raster.data.subarray(center, center + 4)), [255, 0, 0, 255],
      `${position}: capture must contain the visible target, not a document-coordinate neighbor`);
    await page.evaluate(() => window.scrollBy(0, 37));
    await settled(page);
    const actual = await target.capture();
    const report = checkSnapshot(actual, {
      reference: before, stableGeometry: { reference: before.measurement, tolerance: 0 },
    });
    await writeBrowserArtifacts(join(output, `capture-${position}`), {
      actual, reference: before, report,
    });
    deepStrictEqual(report.findings, [], `${position}: viewport-bound pixels must survive page scrolling`);
  } finally {
    await context.close();
  }
}

function targets(page, renderer) {
  if (renderer === 'dom') {
    return {
      panel: domTarget(page, {
        root: page.locator('#panel'),
        contentBox: page.locator('#content'),
        content: Object.fromEntries(['title', 'body', 'action', 'status'].map(
          (name) => [name, page.locator(`#${name}`)],
        )),
      }),
      action: domTarget(page, {
        root: page.locator('#action'),
        contentBox: page.locator('#action-content'),
        content: { label: page.locator('#action-label') },
      }),
    };
  }
  const target = (id) => regionTarget(page, {
    prepare: () => page.locator('#panel').scrollIntoViewIfNeeded(),
    measure: () => page.evaluate((name) => window.browserE2EFixture.measure(name), id),
  });
  return { panel: target('panel'), action: target('action') };
}

async function settled(page) {
  await page.evaluate(() => new Promise((done) => {
    requestAnimationFrame(() => requestAnimationFrame(done));
  }));
}

// The same scenario is used unchanged for both renderers and every fault. It
// only reads readiness/measurement instrumentation; no hook sets UI state.
async function scenario(page, bound, directory, scroll, baselineEnvironment) {
  const findings = [];
  async function verify(step, actual, options) {
    const report = checkSnapshot(actual, options);
    findings.push(...report.findings.map((finding) => ({ step, code: finding.code })));
    await writeBrowserArtifacts(join(directory, step), {
      actual, report,
      ...(options.reference ? { reference: options.reference } : {}),
      ...(options.changedFrom ? { changedFrom: options.changedFrom } : {}),
    });
    return report;
  }

  const normalPanel = await bound.panel.capture();
  const normal = await bound.action.capture();
  await verify('initial-panel', normalPanel, {
    contentFits: true,
    text: { status: 'Choose your next adventure.', action: 'Accept quest' },
  });
  await verify('initial-action', normal, { contentFits: true, text: { label: 'Accept quest' } });
  const baseline = baselineEnvironment === undefined ? undefined : await restoreBaseline(
    join(directory, 'baseline.json'), baselineEnvironment, normalPanel,
  );
  if (baseline) {
    await verify('baseline-initial', await bound.panel.capture(), {
      reference: baseline,
      stableGeometry: { reference: baseline.measurement, tolerance: 0 },
      contentFits: true,
      text: { status: 'Choose your next adventure.', action: 'Accept quest' },
    });
  }
  strictEqual(normal.raster.width, normal.clip.width);
  strictEqual(normal.raster.height, normal.clip.height);
  strictEqual(normal.measurement.bounds.height, 52, 'Action geometry uses CSS pixels at both DPRs.');
  strictEqual(normal.raster.height,
    Math.ceil(normal.measurement.bounds.y + 52) - Math.floor(normal.measurement.bounds.y),
    'Capture encloses fractional CSS coordinates without multiplying by device pixel ratio.');
  await verify('stable-pixels', await bound.action.capture(), { reference: normal });

  if (scroll) {
    ok(await page.evaluate(() => window.scrollY > 0), 'Scrolled case must actually scroll.');
    const before = await bound.panel.capture();
    await page.evaluate(() => window.scrollBy(0, -24));
    await settled(page);
    const after = await bound.panel.capture();
    ok(before.measurement.bounds.y !== after.measurement.bounds.y, 'Scroll must change viewport coordinates.');
    await verify('scroll-pixels', after, {
      reference: before,
      stableGeometry: { reference: before.measurement, tolerance: 0.01 },
      contentFits: true,
    });
  }

  const stable = { reference: normal.measurement, tolerance: 0.1 };
  await bound.action.hover();
  await settled(page);
  const hover = await bound.action.capture();
  await verify('hover', hover, {
    changedFrom: normal, stableGeometry: stable, contentFits: true,
    text: { label: 'Accept quest' },
  });

  await bound.action.press();
  await settled(page);
  const pressed = await bound.action.capture();
  const pressedPanel = await bound.panel.capture();
  await verify('pressed', pressed, {
    changedFrom: hover, stableGeometry: stable, contentFits: true,
    text: { label: 'Accept quest' },
  });

  await bound.action.release();
  await settled(page);
  const acceptedPanel = await bound.panel.capture();
  await verify('activation-panel', acceptedPanel, {
    changedFrom: pressedPanel,
    contentFits: true,
    text: { status: 'Quest accepted: 1', action: 'Accept quest' },
  });
  await verify('activation-action', await bound.action.capture(), {
    stableGeometry: stable, contentFits: true, text: { label: 'Accept quest' },
  });
  if (baseline) {
    const comparison = checkSnapshot(acceptedPanel, { reference: baseline });
    ok(comparison.findings.some((finding) => finding.code === 'browser.pixels'),
      'Real activation must change rendered pixels against the separately loaded baseline.');
    await writeBrowserArtifacts(join(directory, 'baseline-activation'), {
      actual: acceptedPanel, reference: baseline, report: comparison,
    });
    await verify('baseline-changed', acceptedPanel, { changedFrom: baseline });
  }
  await bound.action.click();
  await settled(page);
  await verify('second-click', await bound.panel.capture(), {
    contentFits: true,
    text: { status: 'Quest accepted: 2' },
  });
  return { findings, state: await page.evaluate(() => window.browserE2EFixture.getState()) };
}

const requiredFailure = {
  'missing-handler': { step: 'activation-panel', code: 'browser.text' },
  'stale-paint': { step: 'activation-panel', code: 'browser.pixels-unchanged' },
  shift: { step: 'activation-action', code: 'browser.geometry' },
  clipping: { step: 'activation-panel', code: 'browser.content-overflow' },
  overlay: { step: 'hover', code: 'browser.pixels-unchanged' },
};

async function runCase(renderer, configuration, fault = 'none', persistBaseline = false) {
  const { width, deviceScaleFactor, scroll } = configuration;
  const name = `${renderer}-${width}-dpr${deviceScaleFactor}-${scroll ? 'scroll' : 'top'}-${fault}`;
  const context = await browser.newContext({
    viewport: { width, height: 900 }, deviceScaleFactor,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    const query = new URLSearchParams({ renderer, fault, scroll: scroll ? '1' : '0' });
    await page.goto(`${base}/?${query}`);
    await page.evaluate(async () => { await window.browserE2EFixture.ready; });
    await settled(page);
    const baselineEnvironment = persistBaseline
      ? `browser-consumer:${process.platform}:${process.arch}:${browser.version()}:${renderer}:${width}x900@${deviceScaleFactor}:fixture-v1`
      : undefined;
    const result = await scenario(
      page, targets(page, renderer), join(output, name), scroll, baselineEnvironment,
    );
    deepStrictEqual(errors, [], `${name}: page errors`);
    if (fault === 'none') {
      deepStrictEqual(result.findings, [], `${name}: expected all public assertions to pass`);
      strictEqual(result.state.accepted, 2, `${name}: both real clicks must activate the application`);
      strictEqual(result.state.paintedAccepted, 2, `${name}: activation must reach the rendered UI`);
    } else {
      const expected = requiredFailure[fault];
      ok(result.findings.some((finding) => finding.step === expected.step && finding.code === expected.code),
        `${name}: expected ${expected.step}/${expected.code}, got ${JSON.stringify(result.findings)}`);
      // Healthy preconditions prevent an unrelated initial layout defect from
      // making a broken interaction look like a successful negative control.
      deepStrictEqual(result.findings.filter((finding) =>
        finding.step.startsWith('initial-') || finding.step === 'stable-pixels' || finding.step === 'scroll-pixels'),
      [], `${name}: fault must leave the initial UI valid`);
      if (fault === 'stale-paint') {
        strictEqual(result.state.accepted, 2, 'The logical app must advance while painting is stale.');
        strictEqual(result.state.paintedAccepted, 0, 'The pixel assertion must detect the stale render.');
      }
      if (fault === 'missing-handler' || fault === 'overlay') {
        strictEqual(result.state.accepted, 0, 'Fault must prevent real activation.');
      }
    }
    cases.push({ name, renderer, fault, rejected: result.findings.length > 0, findings: result.findings });
    if (persistBaseline) baselineRoundTrips += 1;
  } finally {
    await context.close();
  }
}

try {
  browser = await chromium.launch({ channel: process.env.SLICEWRIGHT_CHROME_CHANNEL ?? 'chrome' });
  for (const position of ['fixed', 'sticky']) {
    await checkPositionedCapture(position);
  }
  const configurations = [
    { width: 320, deviceScaleFactor: 1, scroll: false },
    { width: 320, deviceScaleFactor: 2, scroll: true },
    { width: 960, deviceScaleFactor: 1, scroll: true },
    { width: 960, deviceScaleFactor: 2, scroll: false },
  ];
  for (const renderer of ['dom', 'canvas']) {
    for (const configuration of configurations) {
      await runCase(renderer, configuration, 'none', configuration === configurations[0]);
    }
    for (const fault of Object.keys(requiredFailure)) {
      await runCase(renderer, { width: 960, deviceScaleFactor: 1, scroll: false }, fault);
    }
  }
  const report = {
    cases,
    passed: cases.filter((entry) => entry.fault === 'none').length,
    negativeControls: cases.filter((entry) => entry.fault !== 'none' && entry.rejected).length,
    captureProbes: 2,
    baselineRoundTrips,
    output,
  };
  await writeFile(join(output, 'consumer-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
