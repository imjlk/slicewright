#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { cli, define } from 'gunshi';

import { joinNegativeNumbers } from './argv.js';
import { defaultChromaOptions, removeChroma } from './chroma.js';
import {
  defaultInspectOptions,
  inspectRaster,
  type Finding,
  type InspectOptions,
  type InspectReport,
} from './inspect.js';
import { normalizeRaster } from './normalize.js';
import type { SliceLayout } from './layout.js';
import { buildPack } from './pack-files.js';
import { defaultPackOptions } from './pack.js';
import { inspectAtlas } from './phaser.js';
import { decodePng, encodePng } from './png.js';
import { buildPromptPlan, promptBackgrounds, uiKinds } from './prompt.js';
import type { Raster } from './raster.js';
import {
  defaultPreviewMaxWidth,
  previewCellLabels,
  renderPreviewSheet,
  type PreviewCellLabel,
  type PreviewOptions,
} from './render.js';
import { resizeRaster, targetSize } from './resize.js';
import { parseBorders, parseInsets, scale9BordersToInsets, type SliceInsets } from './slices.js';
import { exportForTarget, findTarget, sliceTargets } from './targets/index.js';

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
  padding: {
    type: 'string',
    description: 'Give content padding instead of detecting it: l,r,t,b or h,v or n',
  },
  regions: {
    type: 'enum',
    choices: ['single', 'multi'],
    default: 'single',
    description: 'multi keeps every long stretch run on an axis, around fixed detail',
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
  readonly padding?: string | undefined;
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
    cells: {
      type: 'string',
      description: `Cells to show, comma-separated: ${previewCellLabels.join(',')}`,
    },
    zoom: {
      type: 'number',
      default: 1,
      description: 'Scale every cell by this whole number (1-8), nearest-neighbor',
    },
    'max-width': {
      type: 'number',
      default: defaultPreviewMaxWidth,
      description: 'Wrap cells to a new row past this sheet width',
    },
    ...sliceArgs,
  },
  run: (ctx) => {
    const raster = readPng(ctx.values.input);
    const settings = inspectOptions(ctx.values, raster);
    const options = previewOptions(ctx.values);
    const report = inspectRaster(raster, settings);
    const sheet = renderPreviewSheet(raster, report.layout, options);
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
    'image-ref': {
      type: 'string',
      description: 'How the atlas refers to the image; defaults to its path from the atlas',
    },
    ...sliceArgs,
  },
  run: (ctx) => {
    const { input, name, out } = ctx.values;
    const raster = readPng(input);
    const report = inspectRaster(raster, inspectOptions(ctx.values, raster));
    const phaser = phaserAtlas({
      name,
      imagePath: input,
      imageRef: ctx.values['image-ref'],
      atlasPath: out,
      raster,
      layout: report.layout,
    });
    print({
      image: input,
      atlas: phaser.atlas,
      atlasFindings: phaser.findings,
      ...summary(report),
    });
    failOnErrors(report.ok && phaser.ok);
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
    // Validate every option before any file is written.
    const targetIds = targetList(ctx.values.target);
    const assetName = ctx.values.name ?? basename(out).replace(/\.png$/i, '');
    if (targetIds.length > 0) {
      insideDirectory(dirname(out), assetName);
    }
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
    let atlasFindings: readonly Finding[] = [];
    let atlasOk = true;
    if (ctx.values.atlas !== undefined) {
      const phaser = phaserAtlas({
        name: ctx.values.name ?? basename(out).replace(/\.png$/i, ''),
        imagePath: out,
        imageRef: ctx.values['image-ref'],
        atlasPath: ctx.values.atlas,
        raster: result.raster,
        layout: result.report.layout,
      });
      atlasOk = phaser.ok;
      atlasOut = phaser.ok ? ctx.values.atlas : undefined;
      atlasFindings = phaser.findings;
    }
    const exports = targetIds.map((id) =>
      writeExport(id, {
        name: assetName,
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
      ...(atlasFindings.length === 0 ? {} : { atlasFindings }),
      steps: result.steps,
      ...summary(result.report),
      ...(exports.length === 0 ? {} : { exports }),
    });
    failOnErrors(result.report.ok && atlasOk && exports.every((item) => item.ok));
  },
});

const pack = define({
  name: 'pack',
  description: 'Pack the frames of several atlases into one image and JSON Hash atlas',
  args: {
    inputs: {
      type: 'positional',
      multiple: true,
      required: true,
      description: 'Atlas JSON files, such as the one-frame atlases normalize and export write',
    },
    out: {
      type: 'string',
      required: true,
      description: 'Packed PNG to write; the atlas goes next to it',
    },
    name: {
      type: 'string',
      description: 'Texture key and file name for the atlas and stylesheet; defaults to the PNG name',
    },
    spacing: {
      type: 'number',
      default: defaultPackOptions.spacing,
      description: 'Transparent pixels between frames',
    },
    extrude: {
      type: 'number',
      default: defaultPackOptions.extrude,
      description: "Pixels of each frame's edge repeated outward",
    },
    css: {
      type: 'boolean',
      description: "Also write one stylesheet with a border-image class per frame, using each frame's own image",
    },
    ...matchArgs,
  },
  run: (ctx) => {
    const { out } = ctx.values;
    const outDir = dirname(out);
    const name = ctx.values.name ?? basename(out).replace(/\.png$/i, '');
    // Validate every option before any file is written.
    insideDirectory(outDir, `${name}.json`);
    insideDirectory(outDir, `${name}.css`);
    const result = buildPack({
      inputs: ctx.values.inputs,
      out,
      name,
      css: ctx.values.css === true,
      spacing: ctx.values.spacing,
      extrude: ctx.values.extrude,
      match: matchOptions(ctx.values),
      // Loader calls resolve from where the game is served; assume the working directory.
      servedFrom: process.cwd(),
    });
    mkdirSync(outDir, { recursive: true });
    for (const file of result.files) {
      writeFileSync(file.path, file.contents);
    }
    print({
      inputs: ctx.values.inputs,
      files: result.files.map((file) => file.path),
      size: result.size,
      frames: result.frames,
      ok: result.ok,
      findings: result.report.findings,
      frameFindings: result.report.frames.map((frame) => ({
        name: frame.name,
        ok: frame.ok,
        findings: [...frame.findings, ...(frame.inspection?.findings ?? [])],
      })),
      ...(ctx.values.css === true ? { cssFindings: result.cssFindings } : {}),
      usage: result.usage,
    });
    failOnErrors(result.ok);
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

/**
 * Writes a Phaser atlas through the Phaser target, so `frame` and
 * `normalize --atlas` get the same capability checks and image reference as
 * `export --target phaser`. Without a path the atlas is returned instead.
 */
function phaserAtlas(options: {
  readonly name: string;
  readonly imagePath: string;
  readonly imageRef: string | undefined;
  readonly atlasPath: string | undefined;
  readonly raster: Raster;
  readonly layout: SliceLayout;
}): { ok: boolean; atlas: unknown; findings: readonly Finding[] } {
  const imageRef =
    options.imageRef ??
    (options.atlasPath === undefined
      ? basename(options.imagePath)
      : urlPath(relative(dirname(resolve(options.atlasPath)), resolve(options.imagePath))));
  const result = exportForTarget('phaser', {
    name: options.name,
    imageRef,
    raster: options.raster,
    layout: options.layout,
  });
  const ok = !result.findings.some((finding) => finding.severity === 'error');
  const contents = result.files[0]?.contents;
  if (!ok || typeof contents !== 'string') {
    return { ok: false, atlas: undefined, findings: result.findings };
  }
  if (options.atlasPath !== undefined) {
    writeFileSync(options.atlasPath, contents);
  }
  return {
    ok,
    atlas: options.atlasPath ?? (JSON.parse(contents) as unknown),
    findings: result.findings,
  };
}

/** A path as a URL-style reference: forward slashes on every platform. */
function urlPath(path: string): string {
  return path.split(sep).join('/').replace(/\\/g, '/');
}

/**
 * `file` joined to `directory`. Only a plain file name is accepted: a path
 * component, even one inside the directory, could pass through a symlink.
 */
function insideDirectory(directory: string, file: string): string {
  if (file.includes('/') || file.includes('\\') || file === '.' || file === '..') {
    throw new UsageError(
      `"${file}" must be a plain file name; pick a --name without path separators.`,
    );
  }
  const path = join(directory, file);
  const inside = relative(resolve(directory), resolve(path));
  // A leading ".." component escapes; a name such as "..panel" does not.
  if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new UsageError(`"${file}" would be written outside ${directory}; pick a plain --name.`);
  }
  return path;
}

function targetList(value: string | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  const ids = value
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (ids.length === 0) {
    throw new UsageError(
      `--target names no target. Known targets: ${Object.keys(sliceTargets).join(', ')}.`,
    );
  }
  for (const id of ids) {
    if (findTarget(id) === undefined) {
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
    (urlPath(relative(resolve(options.outDir), resolve(options.imagePath))) ||
      basename(options.imagePath));
  const result = exportForTarget(id, {
    name: options.name,
    imageRef,
    raster: options.raster,
    layout: options.layout,
    // Loader calls resolve from where the game is served; assume the working directory.
    loaderPaths: {
      image: urlPath(relative(process.cwd(), resolve(options.imagePath))),
      directory: urlPath(relative(process.cwd(), resolve(options.outDir))),
    },
  });
  const files = result.files.map((file) => {
    const path = insideDirectory(options.outDir, file.path);
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
    ...(values.padding === undefined ? {} : { contentPadding: parseInsets(values.padding) }),
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

function previewOptions(values: {
  readonly cells?: string | undefined;
  readonly zoom: number;
  readonly 'max-width': number;
}): PreviewOptions {
  const zoom = values.zoom;
  const maxWidth = values['max-width'];
  if (!Number.isInteger(zoom) || zoom < 1 || zoom > 8) {
    throw new UsageError('--zoom must be a whole number from 1 to 8.');
  }
  if (!Number.isInteger(maxWidth) || maxWidth < 1) {
    throw new UsageError('--max-width must be a positive whole number.');
  }
  if (values.cells === undefined) {
    return { zoom, maxWidth };
  }
  const names = values.cells.split(',').map((name) => name.trim());
  const cells = names.filter((name): name is PreviewCellLabel =>
    (previewCellLabels as readonly string[]).includes(name),
  );
  const unknown = names.filter((name) => !cells.includes(name as PreviewCellLabel));
  if (unknown.length > 0 || cells.length === 0) {
    throw new UsageError(`--cells takes ${previewCellLabels.join(', ')}; got ${values.cells}.`);
  }
  return { cells, zoom, maxWidth };
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
  'ok' | 'mode' | 'insets' | 'scale9Borders' | 'minSize' | 'tile' | 'contentPadding' | 'findings'
> {
  const { ok, mode, insets, scale9Borders, minSize, tile, contentPadding, findings } = report;
  return { ok, mode, insets, scale9Borders, minSize, tile, contentPadding, findings };
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

const subCommands = {
  prompt,
  inspect,
  preview,
  frame,
  atlas,
  key,
  resize,
  normalize,
  pack,
  export: exportCommand,
  targets,
};

// Every flag that takes a number, so `--tolerance -1` reaches validation.
const numberFlags = new Set(
  Object.values(subCommands).flatMap((command) =>
    Object.entries(command.args ?? {})
      .filter(([, arg]) => arg.type === 'number')
      .map(([name]) => `--${name}`),
  ),
);

try {
  await cli(joinNegativeNumbers(process.argv.slice(2), numberFlags), main, {
    name: 'slicewright',
    version,
    subCommands,
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
