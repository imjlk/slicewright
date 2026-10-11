#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { cli, define } from 'gunshi';

import { defaultChromaOptions, removeChroma } from './chroma.js';
import {
  defaultInspectOptions,
  inspectRaster,
  type Finding,
  type InspectOptions,
  type InspectReport,
} from './inspect.js';
import { normalizeRaster } from './normalize.js';
import { createSingleFrameAtlas, inspectAtlas } from './phaser.js';
import { decodePng, encodePng } from './png.js';
import { buildPromptPlan, promptBackgrounds, uiKinds } from './prompt.js';
import type { SliceLayout } from './layout.js';
import type { Raster } from './raster.js';
import { renderPreviewSheet } from './render.js';
import { resizeRaster, targetSize } from './resize.js';
import { parseBorders, parseInsets, scale9BordersToInsets } from './slices.js';
import { exportForTarget, sliceTargets } from './targets/index.js';

/** Exit codes: 0 ok, 1 error findings, 2 usage or input failure. */
const findingsFailed = 1;
const usageFailed = 2;

const matchArgs = {
  tolerance: {
    type: 'number',
    default: defaultInspectOptions.tolerance,
    description: 'Largest premultiplied channel difference, 0-255, that still matches',
  },
  'outlier-ratio': {
    type: 'number',
    default: defaultInspectOptions.outlierRatio,
    description: 'Fraction of pixels per line allowed to exceed the tolerance',
  },
  noise: {
    type: 'enum',
    choices: ['auto', 'off'],
    default: 'auto',
    description: 'auto raises the tolerance to the noise floor of generated art',
  },
} as const;

const sliceArgs = {
  insets: {
    type: 'string',
    description: 'Give insets instead of detecting them: l,r,t,b or h,v or n',
  },
  borders: {
    type: 'string',
    description: 'Give Phaser scale9Borders x,y,w,h instead of insets',
  },
  mode: {
    type: 'enum',
    choices: ['auto', 'nine', 'three', 'three-vertical'],
    default: 'auto',
    description: 'Slice mode: three keeps the height, three-vertical keeps the width',
  },
  regions: {
    type: 'enum',
    choices: ['single', 'multi'],
    default: 'single',
    description: 'multi keeps every long stretch run on an axis (Android nine-patch style)',
  },
  tile: {
    type: 'enum',
    choices: ['x', 'y', 'xy'],
    description: 'Treat these axes as tiled instead of stretched',
  },
  ...matchArgs,
} as const;

const sizeArgs = {
  width: { type: 'number', description: 'Target width in pixels' },
  height: { type: 'number', description: 'Target height in pixels' },
  scale: { type: 'number', description: 'Target scale instead of a size' },
  filter: {
    type: 'enum',
    choices: ['area', 'nearest'],
    default: 'area',
    description: 'area for painted art, nearest for pixel art',
  },
} as const;

const chromaKeyChoices = ['auto', 'green', 'magenta'] as const;

const image = { type: 'positional', description: 'PNG image' } as const;

interface SliceValues {
  readonly regions: string;
  readonly insets?: string | undefined;
  readonly borders?: string | undefined;
  readonly mode: string;
  readonly tile?: string | undefined;
  readonly tolerance: number;
  readonly 'outlier-ratio': number;
  readonly noise: string;
}

const prompt = define({
  name: 'prompt',
  description: 'Plan a generation prompt for stretchable UI art',
  args: {
    kind: { type: 'enum', choices: uiKinds, required: true, description: 'UI element kind' },
    style: { type: 'string', required: true, description: "Art direction in the user's words" },
    background: {
      type: 'enum',
      choices: promptBackgrounds,
      default: 'transparent',
      description: 'Background the generator should paint',
    },
    'pixel-art': { type: 'boolean', description: 'Ask for crisp pixel art' },
  },
  run: (ctx) => {
    const { kind, style, background } = ctx.values;
    print(buildPromptPlan({ kind, style, background, pixelArt: ctx.values['pixel-art'] === true }));
  },
});

const inspect = define({
  name: 'inspect',
  description: 'Detect or check slice insets and report what breaks when stretched',
  args: { input: image, ...sliceArgs },
  run: (ctx) => {
    const raster = readPng(ctx.values.input);
    const report = inspectRaster(raster, inspectOptions(ctx.values, raster));
    print({ image: ctx.values.input, ...report });
    failOnErrors(report.ok);
  },
});

const preview = define({
  name: 'preview',
  description: 'Render the art at several stretched sizes on one PNG',
  args: {
    input: image,
    out: { type: 'string', required: true, description: 'Preview sheet PNG to write' },
    ...sliceArgs,
  },
  run: (ctx) => {
    const raster = readPng(ctx.values.input);
    const settings = inspectOptions(ctx.values, raster);
    const report = inspectRaster(raster, settings);
    const sheet = renderPreviewSheet(raster, report.layout);
    writeFileSync(ctx.values.out, encodePng(sheet.raster));
    print({
      image: ctx.values.input,
      sheet: ctx.values.out,
      cells: sheet.cells,
      ...summary(report),
    });
  },
});

const frame = define({
  name: 'frame',
  description: 'Write a one-frame Phaser JSON Hash atlas with scale9Borders',
  args: {
    input: image,
    name: { type: 'string', required: true, description: 'Frame name' },
    out: { type: 'string', description: 'Atlas JSON to write; printed when omitted' },
    ...sliceArgs,
  },
  run: (ctx) => {
    const { input, name, out } = ctx.values;
    const raster = readPng(input);
    const report = inspectRaster(raster, inspectOptions(ctx.values, raster));
    const imageRef = out === undefined
      ? basename(input)
      : relative(dirname(resolve(out)), resolve(input));
    const atlas = createSingleFrameAtlas(name, imageRef, raster.width, raster.height, report.insets);
    if (out !== undefined) {
      writeFileSync(out, `${JSON.stringify(atlas, null, 2)}\n`);
    }
    print({ image: input, atlas: out ?? atlas, ...summary(report) });
    failOnErrors(report.ok);
  },
});

const atlas = define({
  name: 'atlas',
  description: 'Check the nine-slice frames of a Phaser JSON Hash or JSON Array atlas',
  args: {
    input: { type: 'positional', description: 'Atlas JSON' },
    image: { type: 'string', description: 'Atlas image; defaults to meta.image' },
    frame: { type: 'string', description: 'Check only this frame' },
    ...matchArgs,
  },
  run: (ctx) => {
    const path = ctx.values.input;
    const json: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const imagePath = ctx.values.image ?? resolve(dirname(path), atlasImage(json, path));
    const report = inspectAtlas(
      json,
      readPng(imagePath),
      matchOptions(ctx.values),
      ctx.values.frame,
    );
    print({ atlas: path, image: imagePath, ...report });
    failOnErrors(report.ok);
  },
});

const key = define({
  name: 'key',
  description: 'Remove a green or magenta background and despill the edge',
  args: {
    input: image,
    out: { type: 'string', required: true, description: 'Keyed PNG to write' },
    key: {
      type: 'enum',
      choices: chromaKeyChoices,
      default: 'auto',
      description: 'Key color; auto reads the image border',
    },
    keep: {
      type: 'number',
      default: defaultChromaOptions.keep,
      description: 'Key dominance kept opaque',
    },
    drop: {
      type: 'number',
      default: defaultChromaOptions.drop,
      description: 'Key dominance cleared',
    },
    'despill-radius': {
      type: 'number',
      default: defaultChromaOptions.despillRadius,
      description: 'Despill pixels this close to transparency',
    },
  },
  run: (ctx) => {
    const result = removeChroma(readPng(ctx.values.input), {
      key: ctx.values.key,
      keep: ctx.values.keep,
      drop: ctx.values.drop,
      despillRadius: ctx.values['despill-radius'],
    });
    writeFileSync(ctx.values.out, encodePng(result.raster));
    const { raster: _raster, ...stats } = result;
    print({ image: ctx.values.input, out: ctx.values.out, ...stats });
  },
});

const resize = define({
  name: 'resize',
  description: 'Resize art to its in-game size',
  args: {
    input: image,
    out: { type: 'string', required: true, description: 'Resized PNG to write' },
    ...sizeArgs,
  },
  run: (ctx) => {
    const raster = readPng(ctx.values.input);
    const size = targetSize(raster.width, raster.height, sizeRequest(ctx.values));
    const resized = resizeRaster(raster, size.width, size.height, ctx.values.filter);
    writeFileSync(ctx.values.out, encodePng(resized));
    print({ image: ctx.values.input, out: ctx.values.out, from: dims(raster), to: dims(resized) });
  },
});

const normalize = define({
  name: 'normalize',
  description: 'Crop, resize, pick insets at the final size, and optionally rebuild a minimal texture',
  args: {
    input: image,
    out: { type: 'string', required: true, description: 'Normalized PNG to write' },
    keep: {
      type: 'number',
      description: 'Rebuild keeping this many pixels of each uniform stretch span',
    },
    'no-crop': { type: 'boolean', description: 'Keep transparent margins' },
    atlas: { type: 'string', description: 'Also write a one-frame atlas JSON here' },
    name: {
      type: 'string',
      description: 'Asset name for --atlas and --target; defaults to the file name',
    },
    target: {
      type: 'string',
      description: `Also export for these targets, comma separated: ${Object.keys(sliceTargets).join(', ')}`,
    },
    'image-ref': {
      type: 'string',
      description: 'How --target files refer to the image; defaults to its path from the output',
    },
    ...sizeArgs,
    ...sliceArgs,
  },
  run: (ctx) => {
    const { input, out } = ctx.values;
    const source = readPng(input);
    const result = normalizeRaster(source, {
      inspect: inspectOptions(ctx.values, undefined),
      crop: ctx.values['no-crop'] !== true,
      filter: ctx.values.filter,
      ...sizeRequest(ctx.values),
      ...(ctx.values.keep === undefined ? {} : { keep: ctx.values.keep }),
    });
    writeFileSync(out, encodePng(result.raster));
    let atlasOut: string | undefined;
    if (ctx.values.atlas !== undefined) {
      atlasOut = ctx.values.atlas;
      const frameName = ctx.values.name ?? basename(out).replace(/\.png$/i, '');
      const imageRef = relative(dirname(resolve(atlasOut)), resolve(out));
      const json = createSingleFrameAtlas(
        frameName,
        imageRef,
        result.raster.width,
        result.raster.height,
        result.report.insets,
      );
      writeFileSync(atlasOut, `${JSON.stringify(json, null, 2)}\n`);
    }
    const exports = targetList(ctx.values.target).map((id) =>
      writeExport(id, {
        name: ctx.values.name ?? basename(out).replace(/\.png$/i, ''),
        outDir: dirname(out),
        imagePath: out,
        imageRef: ctx.values['image-ref'],
        raster: result.raster,
        layout: result.report.layout,
      }),
    );
    print({
      image: input,
      out,
      atlas: atlasOut,
      steps: result.steps,
      ...summary(result.report),
      ...(exports.length === 0 ? {} : { exports }),
    });
    failOnErrors(result.report.ok && exports.every((item) => item.ok));
  },
});

const targets = define({
  name: 'targets',
  description: 'List export targets and what each can represent',
  run: () => {
    print(
      Object.values(sliceTargets).map(({ id, label, status, capabilities }) => ({
        id,
        label,
        status,
        capabilities,
      })),
    );
  },
});

const exportCommand = define({
  name: 'export',
  description: 'Export the slice layout for one or more engine targets',
  args: {
    input: image,
    target: {
      type: 'string',
      required: true,
      description: `Targets, comma separated: ${Object.keys(sliceTargets).join(', ')}`,
    },
    'out-dir': { type: 'string', default: '.', description: 'Directory for the exported files' },
    'image-ref': {
      type: 'string',
      description: 'How the exported files refer to the image; defaults to its path from --out-dir',
    },
    name: { type: 'string', description: 'Asset name; defaults to the file name' },
    ...sliceArgs,
  },
  run: (ctx) => {
    const { input } = ctx.values;
    const raster = readPng(input);
    const report = inspectRaster(raster, inspectOptions(ctx.values, raster));
    const exports = targetList(ctx.values.target).map((id) =>
      writeExport(id, {
        name: ctx.values.name ?? basename(input).replace(/\.png$/i, ''),
        outDir: ctx.values['out-dir'],
        imagePath: input,
        imageRef: ctx.values['image-ref'],
        raster,
        layout: report.layout,
      }),
    );
    print({ image: input, ...summary(report), exports });
    failOnErrors(report.ok && exports.every((item) => item.ok));
  },
});

function targetList(value: string | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  const ids = value
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  for (const id of ids) {
    if (sliceTargets[id] === undefined) {
      throw new UsageError(
        `Unknown target "${id}". Known targets: ${Object.keys(sliceTargets).join(', ')}.`,
      );
    }
  }
  return ids;
}

function writeExport(
  id: string,
  options: {
    readonly name: string;
    readonly outDir: string;
    readonly imagePath: string;
    readonly imageRef?: string | undefined;
    readonly raster: Raster;
    readonly layout: SliceLayout;
  },
): { target: string; ok: boolean; files: string[]; usage: string; findings: readonly Finding[] } {
  mkdirSync(options.outDir, { recursive: true });
  const imageRef =
    options.imageRef ??
    (relative(resolve(options.outDir), resolve(options.imagePath)) || basename(options.imagePath));
  const result = exportForTarget(id, {
    name: options.name,
    imageRef,
    raster: options.raster,
    layout: options.layout,
  });
  const files = result.files.map((file) => {
    const path = join(options.outDir, file.path);
    writeFileSync(path, file.contents);
    return path;
  });
  return {
    target: id,
    ok: !result.findings.some((finding) => finding.severity === 'error'),
    files,
    usage: result.usage,
    findings: result.findings,
  };
}

/** Insets given as borders need the final image size, so they are resolved against `raster`. */
function inspectOptions(values: SliceValues, raster: Raster | undefined): InspectOptions {
  if (values.insets !== undefined && values.borders !== undefined) {
    throw new UsageError('Give --insets or --borders, not both.');
  }
  if (values.borders !== undefined && raster === undefined) {
    throw new UsageError('--borders depends on the final size; use --insets with normalize.');
  }
  const insets =
    values.insets !== undefined
      ? parseInsets(values.insets)
      : values.borders !== undefined && raster !== undefined
        ? scale9BordersToInsets(parseBorders(values.borders), raster.width, raster.height)
        : undefined;
  const tile = values.tile ?? '';
  return {
    ...matchOptions(values),
    mode:
      values.mode === 'nine' || values.mode === 'three' || values.mode === 'three-vertical'
        ? values.mode
        : 'auto',
    regions: values.regions === 'multi' ? 'multi' : 'single',
    tile: { x: tile.includes('x'), y: tile.includes('y') },
    ...(insets === undefined ? {} : { insets }),
  };
}

function matchOptions(values: {
  readonly tolerance: number;
  readonly 'outlier-ratio': number;
  readonly noise: string;
}): InspectOptions {
  const tolerance = values.tolerance;
  const outlierRatio = values['outlier-ratio'];
  if (!(tolerance >= 0 && tolerance <= 255)) {
    throw new UsageError('--tolerance must be between 0 and 255.');
  }
  if (!(outlierRatio >= 0 && outlierRatio < 1)) {
    throw new UsageError('--outlier-ratio must be at least 0 and below 1.');
  }
  return {
    ...defaultInspectOptions,
    tolerance,
    outlierRatio,
    noise: values.noise === 'off' ? 'off' : 'auto',
  };
}

function sizeRequest(values: {
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly scale?: number | undefined;
}): { width?: number; height?: number; scale?: number } {
  const { width, height, scale } = values;
  if (scale !== undefined && (width !== undefined || height !== undefined)) {
    throw new UsageError('Give --scale or --width/--height, not both.');
  }
  return {
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(scale === undefined ? {} : { scale }),
  };
}

function atlasImage(json: unknown, path: string): string {
  if (typeof json === 'object' && json !== null && 'meta' in json) {
    const meta = (json as { meta?: { image?: unknown } }).meta;
    if (typeof meta?.image === 'string') {
      return meta.image;
    }
  }
  throw new UsageError(`${path} has no meta.image; pass --image.`);
}

function summary(report: InspectReport): Pick<
  InspectReport,
  'ok' | 'mode' | 'insets' | 'scale9Borders' | 'minSize' | 'tile' | 'findings'
> {
  const { ok, mode, insets, scale9Borders, minSize, tile, findings } = report;
  return { ok, mode, insets, scale9Borders, minSize, tile, findings };
}

function readPng(path: string | undefined): Raster {
  if (path === undefined) {
    throw new UsageError('Missing the input path.');
  }
  return decodePng(readFileSync(path));
}

function dims(raster: Raster): { width: number; height: number } {
  return { width: raster.width, height: raster.height };
}

function failOnErrors(ok: boolean): void {
  if (!ok) {
    process.exitCode = findingsFailed;
  }
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

class UsageError extends Error {}

const version = (
  JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string }
).version;

const main = define({
  name: 'slicewright',
  description: 'Prompt, inspect, and preview nine-slice and three-slice UI art. Every command prints JSON.',
  run: () => {
    process.stdout.write('Run slicewright --help for the commands.\n');
    process.exitCode = usageFailed;
  },
});

try {
  await cli(process.argv.slice(2), main, {
    name: 'slicewright',
    version,
    subCommands: {
      prompt,
      inspect,
      preview,
      frame,
      atlas,
      key,
      resize,
      normalize,
      export: exportCommand,
      targets,
    },
    // stdout carries JSON only: no banner, no validation text; errors go to stderr.
    renderHeader: null,
    renderValidationErrors: null,
    // Unknown or misspelled flags are errors, not silently ignored.
    strict: true,
  });
} catch (error) {
  const messages =
    error instanceof AggregateError
      ? error.errors.map((item: unknown) => (item instanceof Error ? item.message : String(item)))
      : [error instanceof Error ? error.message : String(error)];
  process.stderr.write(messages.map((message) => `slicewright: ${message}\n`).join(''));
  process.exitCode = usageFailed;
}
