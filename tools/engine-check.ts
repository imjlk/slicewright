import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

import { chromium, type Page } from 'playwright-core';

import { layoutFromInsets } from '../src/layout.js';
import { decodePng } from '../src/png.js';
import { createRaster, pixelOffset, rasterDifference, type Raster } from '../src/raster.js';
import { renderLayout } from '../src/render.js';
import { scale9BordersToInsets, type Scale9Borders } from '../src/slices.js';

// Renders a manifest in real engines through headless Chrome and prints what
// they built. Phaser: sizes, the insets NineSlice read, and rebuilt textures
// against their sources. CSS: every exported border-image class against
// slicewright's own renderer.
const { values } = parseArgs({
  options: {
    manifest: { type: 'string', default: 'examples/real/manifest.json' },
    engine: { type: 'string', default: 'all' },
    screenshot: { type: 'string' },
    'pixel-art': { type: 'boolean' },
    'max-mean': { type: 'string', default: '2' },
    'css-max-mean': { type: 'string', default: '4' },
  },
});
const knownEngines = ['phaser', 'css'];
if (values.engine !== 'all' && !knownEngines.includes(values.engine)) {
  usage(`--engine must be all, ${knownEngines.join(', or ')}; got "${values.engine}".`);
}
for (const name of ['max-mean', 'css-max-mean'] as const) {
  const threshold = Number(values[name]);
  if (!Number.isFinite(threshold) || threshold < 0) {
    usage(`--${name} must be a non-negative number; got "${values[name]}".`);
  }
}
const engines = values.engine === 'all' ? knownEngines : [values.engine];

/** A typo must never produce a green check that compared nothing. */
function usage(message: string): never {
  process.stderr.write(`engine-check: ${message}\n`);
  process.exit(2);
}

const root = resolve('.');
const types: Readonly<Record<string, string>> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.css': 'text/css',
};
const server = createServer((request, response) => {
  const path = normalize(
    join(root, decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname)),
  );
  if (!path.startsWith(root + sep) || !existsSync(path) || !statSync(path).isFile()) {
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
const output: Record<string, unknown> = {};
let failed = false;
try {
  if (engines.includes('phaser')) {
    const result = await checkPhaser(await openPage('phaser'));
    output['phaser'] = result;
    failed ||= result.sizeMismatches.length > 0 || result.failing.length > 0;
  }
  if (engines.includes('css')) {
    const result = await checkCss(await openPage('css'));
    output['css'] = result;
    failed ||= result.failing.length > 0;
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = failed ? 1 : 0;
} finally {
  await browser.close();
  server.close();
}

async function openPage(engine: 'phaser' | 'css'): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      process.stderr.write(`${engine} page error: ${message.text()}\n`);
    }
  });
  page.on('pageerror', (error) => process.stderr.write(`${engine} page error: ${error.message}\n`));
  const query = new URLSearchParams({ manifest: `/${values.manifest}` });
  if (values['pixel-art'] === true) {
    query.set('pixelArt', '1');
  }
  await page.goto(`http://127.0.0.1:${port}/examples/${engine}/index.html?${query.toString()}`);
  return page;
}

async function checkPhaser(page: Page): Promise<{
  report: Array<{ requested: number[]; rendered: number[] }>;
  comparisons: Array<{ mean: number }>;
  sizeMismatches: unknown[];
  failing: unknown[];
}> {
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
  const maxMean = Number(values['max-mean']);
  return {
    ...result,
    sizeMismatches: result.report.filter((item) => item.requested.join() !== item.rendered.join()),
    // A skipped comparison means the manifest no longer pairs what it claims to.
    failing: result.comparisons.filter(
      (item) => 'skipped' in item || item.mean > maxMean,
    ),
  };
}

interface CssCell {
  readonly entry: string;
  readonly image: string;
  readonly size: string;
  readonly at: [number, number];
  readonly rendered: [number, number];
  readonly borders: Scale9Borders;
  readonly frame: { readonly w: number; readonly h: number };
}

async function checkCss(page: Page): Promise<{
  comparisons: Array<{ entry: string; size: string; mean: number; p99: number; max: number }>;
  failing: unknown[];
}> {
  await page.waitForFunction(() => 'slicewrightCssReport' in globalThis, undefined, {
    timeout: 30_000,
  });
  const cells = await page.evaluate(
    () => (globalThis as unknown as { slicewrightCssReport: CssCell[] }).slicewrightCssReport,
  );
  const screenshot = decodePng(await page.screenshot({ fullPage: true }));
  const background = [0x1d, 0x1d, 0x24] as const;
  const sources = new Map<string, Raster>();
  const comparisons = cells.map((cell) => {
    const source =
      sources.get(cell.image) ?? decodePng(readFileSync(join(root, cell.image.replace(/^\//, ''))));
    sources.set(cell.image, source);
    const { w, h } = cell.frame;
    const shape =
      cell.borders.y === 0 && cell.borders.h === h
        ? 'three'
        : cell.borders.x === 0 && cell.borders.w === w
          ? 'three-vertical'
          : 'nine';
    const layout = layoutFromInsets(scale9BordersToInsets(cell.borders, w, h), w, h, { shape });
    const expected = flatten(renderLayout(source, layout, cell.rendered[0], cell.rendered[1]), background);
    const actual = crop(screenshot, cell.at[0], cell.at[1], cell.rendered[0], cell.rendered[1]);
    const difference = rasterDifference(expected, actual);
    return {
      entry: cell.entry,
      size: cell.size,
      rendered: cell.rendered,
      mean: Number(difference.mean.toFixed(2)),
      p99: Math.round(difference.p99),
      max: Math.round(difference.max),
    };
  });
  const maxMean = Number(values['css-max-mean']);
  return { comparisons, failing: comparisons.filter((item) => item.mean > maxMean) };
}

function flatten(raster: Raster, color: readonly [number, number, number]): Raster {
  const out = createRaster(raster.width, raster.height);
  for (let index = 0; index < raster.data.length; index += 4) {
    const alpha = (raster.data[index + 3] ?? 0) / 255;
    for (let channel = 0; channel < 3; channel += 1) {
      out.data[index + channel] = Math.round(
        (raster.data[index + channel] ?? 0) * alpha + (color[channel] ?? 0) * (1 - alpha),
      );
    }
    out.data[index + 3] = 255;
  }
  return out;
}

function crop(raster: Raster, x: number, y: number, width: number, height: number): Raster {
  const out = createRaster(width, height);
  for (let row = 0; row < height; row += 1) {
    const from = pixelOffset(raster, x, y + row);
    out.data.set(raster.data.subarray(from, from + width * 4), row * width * 4);
  }
  return out;
}
