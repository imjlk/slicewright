import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

import { chromium, type Page } from 'playwright-core';

import { defaultInspectOptions, inspectRaster } from '../src/inspect.js';
import { layoutFromInsets, type SliceLayout } from '../src/layout.js';
import { decodePng } from '../src/png.js';
import { createRaster, pixelOffset, rasterDifference, type Raster } from '../src/raster.js';
import { renderLayout } from '../src/render.js';
import { scale9BordersToInsets, type Scale9Borders, type SliceInsets } from '../src/slices.js';
import { exportForTarget } from '../src/targets/index.js';

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
// The tiling a sample needs comes from slicewright's own detection, never from
// the manifest, so a wrong flag in the manifest or the printed usage is caught.
const detectedTile = detectTiles();
const tileMismatches = [...detectedTile.values()].filter((item) => item.problem !== undefined);
output['tile'] = { detected: [...detectedTile.values()], mismatches: tileMismatches };
failed ||= tileMismatches.length > 0;
// The browsers render the committed files; they must be what the current
// exporters write, or a target regression could stay green.
const staleExports = findStaleExports(detectedTile);
output['staleExports'] = staleExports;
failed ||= staleExports.length > 0;
// Layouts no target exports yet, such as multiple regions, are checked against
// the layout recorded when the sample was made, so detection on real art cannot
// drift unnoticed.
const inspections = checkInspections();
output['inspections'] = inspections;
failed ||= inspections.some((item) => item.problem !== undefined);
try {
  if (engines.includes('phaser')) {
    const result = await checkPhaser(await openPage('phaser'));
    output['phaser'] = result;
    failed ||=
      result.sizeMismatches.length > 0 ||
      result.failing.length > 0 ||
      result.rendererFailing.length > 0;
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
  rendererComparisons: CellComparison[];
  rendererFailing: unknown[];
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
  const canvas = await page.locator('canvas').screenshot();
  if (values.screenshot !== undefined) {
    writeFileSync(values.screenshot, canvas);
  }
  // Every NineSlice, tiled ones included, against slicewright's renderer.
  const rendererComparisons = compareCells(
    decodePng(canvas),
    result.report as unknown as RenderedCell[],
    'floor',
  );
  // --max-mean governs every Phaser comparison; --css-max-mean only the CSS ones.
  const maxMean = Number(values['max-mean']);
  return {
    ...result,
    rendererComparisons,
    rendererFailing: rendererComparisons.filter((item) => item.mean > maxMean),
    sizeMismatches: result.report.filter((item) => item.requested.join() !== item.rendered.join()),
    // A skipped comparison means the manifest no longer pairs what it claims to.
    failing: result.comparisons.filter(
      (item) => 'skipped' in item || item.mean > maxMean,
    ),
  };
}

interface RenderedCell {
  readonly entry: string;
  readonly image: string;
  readonly label?: string;
  readonly size?: string;
  readonly at: [number, number];
  readonly rendered: [number, number];
  readonly borders: Scale9Borders;
  readonly frame: { readonly w: number; readonly h: number };
  /** Tiled axes: '', 'x', 'y', or 'xy'. */
  readonly tile?: string;
  /** The frame's slicewright shape marker, when it has one. */
  readonly shape?: string;
}

interface CellComparison {
  readonly entry: string;
  readonly size: string;
  readonly rendered: [number, number];
  readonly mean: number;
  readonly p99: number;
  readonly max: number;
}

async function checkCss(page: Page): Promise<{
  comparisons: CellComparison[];
  failing: unknown[];
}> {
  await page.waitForFunction(() => 'slicewrightCssReport' in globalThis, undefined, {
    timeout: 30_000,
  });
  const cells = await page.evaluate(
    () => (globalThis as unknown as { slicewrightCssReport: RenderedCell[] }).slicewrightCssReport,
  );
  // CSS `round` takes the nearest tile count, so compare with that rule.
  const comparisons = compareCells(
    decodePng(await page.screenshot({ fullPage: true })),
    cells,
    'round',
  );
  const maxMean = Number(values['css-max-mean']);
  return { comparisons, failing: comparisons.filter((item) => item.mean > maxMean) };
}

/** Compares each rendered cell in `screenshot` with slicewright's own render of it. */
function compareCells(
  screenshot: Raster,
  cells: readonly RenderedCell[],
  tileCount: 'floor' | 'round',
): CellComparison[] {
  const background = [0x1d, 0x1d, 0x24] as const;
  const sources = new Map<string, Raster>();
  return cells.map((cell) => {
    const source =
      sources.get(cell.image) ?? decodePng(readFileSync(join(root, cell.image.replace(/^\//, ''))));
    sources.set(cell.image, source);
    const { w, h } = cell.frame;
    const shape =
      cell.borders.y === 0 && cell.borders.h === h
        ? 'three'
        : cell.shape === 'three-vertical'
          ? 'three-vertical'
          : 'nine';
    const detection = detectedTile.get(cell.entry);
    const detected = detection?.tile ?? '';
    const tile = { x: detected.includes('x'), y: detected.includes('y') };
    // Current detection is the truth; only a rebuilt sample falls back to its atlas.
    const layout =
      detection !== undefined && !detection.rebuilt
        ? detection.layout
        : layoutFromInsets(scale9BordersToInsets(cell.borders, w, h), w, h, { shape, tile });
    const expected = flatten(
      renderLayout(source, layout, cell.rendered[0], cell.rendered[1], tileCount),
      background,
    );
    const actual = crop(screenshot, cell.at[0], cell.at[1], cell.rendered[0], cell.rendered[1]);
    const difference = rasterDifference(expected, actual);
    return {
      entry: cell.entry,
      size: cell.size ?? cell.label ?? '',
      rendered: cell.rendered,
      mean: Number(difference.mean.toFixed(2)),
      p99: Math.round(difference.p99),
      max: Math.round(difference.max),
    };
  });
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

interface TileCheck {
  readonly entry: string;
  /** Tiled axes slicewright detects in the image: '', 'x', 'y', or 'xy'. */
  readonly tile: string;
  /** Tiled axes the Phaser target's printed nineslice call passes. */
  readonly usage: string;
  readonly manifest: string;
  readonly problem?: string;
  /** The layout detection finds now; the truth renders and exports are checked against. */
  readonly layout: SliceLayout;
  /** A rebuilt (`like`) sample, whose layout only its atlas records. */
  readonly rebuilt: boolean;
}

/** Detects each manifest image's tiling and checks the manifest and Phaser usage against it. */
function detectTiles(): Map<string, TileCheck> {
  const manifestPath = join(root, values.manifest);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    entries: Array<{ label: string; atlas: string; tile?: string; like?: string }>;
  };
  const checks = new Map<string, TileCheck>();
  for (const entry of manifest.entries) {
    const atlasPath = join(dirname(manifestPath), entry.atlas);
    const atlas = JSON.parse(readFileSync(atlasPath, 'utf8')) as { meta: { image: string } };
    const raster = decodePng(readFileSync(join(dirname(atlasPath), atlas.meta.image)));
    const report = inspectRaster(raster);
    const axes = (flags: { x: boolean; y: boolean }): string =>
      `${flags.x ? 'x' : ''}${flags.y ? 'y' : ''}`;
    const tile = axes(report.tile);
    const usage = exportForTarget('phaser', {
      name: entry.label,
      imageRef: atlas.meta.image,
      raster,
      layout: report.layout,
    }).usage;
    const flags = /, (true|false), (true|false)\);/.exec(usage);
    const usageTile = axes({ x: flags?.[1] === 'true', y: flags?.[2] === 'true' });
    const manifestTile = entry.tile ?? '';
    const problem =
      usageTile !== tile
        ? `the Phaser usage tiles "${usageTile}" but the image needs "${tile}"`
        : manifestTile !== tile
          ? `the manifest tiles "${manifestTile}" but the image needs "${tile}"`
          : undefined;
    checks.set(entry.label, {
      entry: entry.label,
      tile,
      usage: usageTile,
      manifest: manifestTile,
      ...(problem === undefined ? {} : { problem }),
      layout: report.layout,
      rebuilt: entry.like !== undefined,
    });
  }
  return checks;
}

interface InspectionCheck {
  readonly label: string;
  readonly regions: 'single' | 'multi';
  readonly findings: readonly string[];
  readonly problem?: string;
}

/** Detects each manifest inspection again and compares it with its recorded layout and finding codes. */
function checkInspections(): InspectionCheck[] {
  const manifestPath = join(root, values.manifest);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    inspections?: Array<{ label: string; image: string; regions?: 'multi'; expected: string }>;
  };
  return (manifest.inspections ?? []).map((entry) => {
    const regions = entry.regions ?? 'single';
    const raster = decodePng(readFileSync(join(dirname(manifestPath), entry.image)));
    const report = inspectRaster(raster, { ...defaultInspectOptions, regions });
    const findings = report.findings.map((finding) => finding.code);
    const expectedPath = join(dirname(manifestPath), entry.expected);
    const expected = existsSync(expectedPath)
      ? (JSON.parse(readFileSync(expectedPath, 'utf8')) as { layout: unknown; findings: string[] })
      : undefined;
    const problem =
      expected === undefined
        ? `${entry.expected} is missing`
        : JSON.stringify(report.layout) !== JSON.stringify(expected.layout)
          ? `the detected layout differs from ${entry.expected}`
          : findings.join() !== expected.findings.join()
            ? `the findings ${findings.join(', ')} differ from ${expected.findings.join(', ')}`
            : undefined;
    return { label: entry.label, regions, findings, ...(problem === undefined ? {} : { problem }) };
  });
}

/**
 * Regenerates each sample's Phaser atlas and CSS with the current targets, from
 * the committed atlas and the detected tiling, and lists the files that differ.
 */
function findStaleExports(tiles: ReadonlyMap<string, TileCheck>): string[] {
  const manifestPath = join(root, values.manifest);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    entries: Array<{ label: string; atlas: string; css?: string }>;
  };
  const stale: string[] = [];
  for (const entry of manifest.entries) {
    const atlasPath = join(dirname(manifestPath), entry.atlas);
    const atlasText = readFileSync(atlasPath, 'utf8');
    const atlas = JSON.parse(atlasText) as {
      frames: Record<
        string,
        {
          frame: { w: number; h: number };
          scale9Borders: Scale9Borders;
          slicewright?: { shape?: string; contentPadding?: SliceInsets };
        }
      >;
      meta: { image: string };
    };
    const [name, frame] = Object.entries(atlas.frames)[0] ?? [];
    if (name === undefined || frame === undefined) {
      stale.push(`${entry.atlas}: no frame`);
      continue;
    }
    const { w, h } = frame.frame;
    const shape =
      frame.scale9Borders.y === 0 && frame.scale9Borders.h === h
        ? 'three'
        : frame.slicewright?.shape === 'three-vertical'
          ? 'three-vertical'
          : 'nine';
    const detection = tiles.get(entry.label);
    const tile = detection?.tile ?? '';
    // A committed export must match what the current detection and targets write;
    // a rebuilt sample can only be regenerated from its own atlas.
    const layout =
      detection !== undefined && !detection.rebuilt
        ? detection.layout
        : layoutFromInsets(scale9BordersToInsets(frame.scale9Borders, w, h), w, h, {
            shape,
            tile: { x: tile.includes('x'), y: tile.includes('y') },
          });
    const raster = decodePng(readFileSync(join(dirname(atlasPath), atlas.meta.image)));
    // A rebuilt sample's padding, like its layout, is only recorded in its atlas.
    const padding = frame.slicewright?.contentPadding;
    const exportLayout =
      detection !== undefined && !detection.rebuilt
        ? layout
        : { ...layout, ...(padding === undefined ? {} : { content: padding }) };
    const input = { name, imageRef: atlas.meta.image, raster, layout: exportLayout };
    const committed: Array<[string, string, string]> = [['phaser', atlasPath, atlasText]];
    if (entry.css !== undefined) {
      const cssPath = join(dirname(manifestPath), entry.css);
      committed.push(['css', cssPath, readFileSync(cssPath, 'utf8')]);
    }
    for (const [target, path, text] of committed) {
      const generated = exportForTarget(target, input).files[0]?.contents;
      if (generated !== text) {
        stale.push(`${path.slice(root.length + 1)} differs from the current ${target} export`);
      }
    }
  }
  return stale;
}
