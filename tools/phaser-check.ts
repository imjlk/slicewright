import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { chromium } from 'playwright-core';

// Renders a manifest through examples/phaser in headless Chrome with real
// WebGL and prints what Phaser built: sizes, insets, and pixel comparisons of
// rebuilt textures against their sources.
const { values } = parseArgs({
  options: {
    manifest: { type: 'string', default: 'examples/real/manifest.json' },
    screenshot: { type: 'string' },
    'pixel-art': { type: 'boolean' },
    'max-mean': { type: 'string', default: '2' },
  },
});

const root = resolve('.');
const types: Readonly<Record<string, string>> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
};
const server = createServer((request, response) => {
  const path = normalize(
    join(root, decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname)),
  );
  if (!path.startsWith(root) || !existsSync(path) || !statSync(path).isFile()) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
  createReadStream(path).pipe(response);
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const address = server.address();
const port = typeof address === 'object' && address !== null ? address.port : 0;

const browser = await chromium.launch({
  channel: process.env['SLICEWRIGHT_CHROME_CHANNEL'] ?? 'chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      process.stderr.write(`page ${message.type()}: ${message.text()}\n`);
    }
  });
  page.on('pageerror', (error) => process.stderr.write(`page error: ${error.message}\n`));
  const query = new URLSearchParams({ manifest: `/${values.manifest}` });
  if (values['pixel-art'] === true) {
    query.set('pixelArt', '1');
  }
  await page.goto(`http://127.0.0.1:${port}/examples/phaser/index.html?${query.toString()}`);
  await page.waitForFunction(() => 'slicewrightCompare' in globalThis, undefined, {
    timeout: 30_000,
  });
  const result = await page.evaluate(() => {
    const scope = globalThis as unknown as {
      slicewrightReport: Array<{ requested: number[]; rendered: number[] }>;
      slicewrightCompare: () => Array<{ mean: number }>;
    };
    return { report: scope.slicewrightReport, comparisons: scope.slicewrightCompare() };
  });
  if (values.screenshot !== undefined) {
    writeFileSync(values.screenshot, await page.locator('canvas').screenshot());
  }
  const sizeMismatches = result.report.filter(
    (item) => item.requested.join() !== item.rendered.join(),
  );
  const maxMean = Number(values['max-mean']);
  const failing = result.comparisons.filter((item) => item.mean > maxMean);
  process.stdout.write(`${JSON.stringify({ ...result, sizeMismatches, failing }, null, 2)}\n`);
  process.exitCode = sizeMismatches.length > 0 || failing.length > 0 ? 1 : 0;
} finally {
  await browser.close();
  server.close();
}
