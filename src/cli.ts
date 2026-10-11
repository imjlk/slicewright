#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  defaultInspectOptions,
  inspectRaster,
  type Finding,
  type InspectOptions,
  type InspectReport,
} from './inspect.js';
import { createSingleFrameAtlas, inspectAtlas, type AtlasReport } from './phaser.js';
import { decodePng, encodePng } from './png.js';
import { buildPromptPlan, promptBackgrounds, uiKinds } from './prompt.js';
import { renderPreviewSheet } from './render.js';
import { parseBorders, parseInsets, scale9BordersToInsets } from './slices.js';

const usage = `slicewright <command> [options]

Commands:
  prompt   --kind <${uiKinds.join('|')}> --style <text>
           [--background <${promptBackgrounds.join('|')}>] [--pixel-art]
  inspect  <image.png> [slice options]
  preview  <image.png> --out <sheet.png> [slice options]
  frame    <image.png> --name <frame> [--out <atlas.json>] [slice options]
  atlas    <atlas.json> [--image <atlas.png>] [--frame <name>] [match options]

Slice options:
  --insets <l,r,t,b | h,v | n>   give insets instead of detecting them
  --borders <x,y,w,h>            give Phaser scale9Borders instead
  --mode <auto|nine|three>       default auto
  --tile <x|y|xy>                treat these axes as tiled
Match options:
  --tolerance <0-255>            default 4
  --outlier-ratio <0-1>          default 0

Every command prints JSON. inspect, frame, and atlas exit 1 when a finding is an error.`;

const options = {
  kind: { type: 'string' },
  style: { type: 'string' },
  background: { type: 'string' },
  'pixel-art': { type: 'boolean' },
  insets: { type: 'string' },
  borders: { type: 'string' },
  mode: { type: 'string' },
  tile: { type: 'string' },
  tolerance: { type: 'string' },
  'outlier-ratio': { type: 'string' },
  out: { type: 'string' },
  name: { type: 'string' },
  image: { type: 'string' },
  frame: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const;

type Values = ReturnType<typeof parseArgs<{ options: typeof options; allowPositionals: true }>>['values'];

function main(argv: readonly string[]): number {
  const { values, positionals } = parseArgs({ args: [...argv], options, allowPositionals: true });
  const [command, input] = positionals;
  if (values.help === true || command === undefined) {
    process.stdout.write(`${usage}\n`);
    return command === undefined && values.help !== true ? 1 : 0;
  }
  switch (command) {
    case 'prompt':
      return runPrompt(values);
    case 'inspect':
      return runInspect(required(input, 'image path'), values);
    case 'preview':
      return runPreview(required(input, 'image path'), values);
    case 'frame':
      return runFrame(required(input, 'image path'), values);
    case 'atlas':
      return runAtlas(required(input, 'atlas JSON path'), values);
    default:
      throw new Error(`Unknown command "${command}".\n\n${usage}`);
  }
}

function runPrompt(values: Values): number {
  const kind = oneOf(values.kind, uiKinds, '--kind');
  const background = oneOf(values.background ?? 'transparent', promptBackgrounds, '--background');
  const style = required(values.style, '--style');
  print(buildPromptPlan({ kind, style, background, pixelArt: values['pixel-art'] === true }));
  return 0;
}

function runInspect(path: string, values: Values): number {
  const raster = decodePng(readFileSync(path));
  const report = inspectRaster(raster, inspectOptions(values, raster.width, raster.height));
  print({ image: path, ...report });
  return report.ok ? 0 : 1;
}

function runPreview(path: string, values: Values): number {
  const out = required(values.out, '--out');
  const raster = decodePng(readFileSync(path));
  const settings = inspectOptions(values, raster.width, raster.height);
  const report = inspectRaster(raster, settings);
  const sheet = renderPreviewSheet(raster, report.insets, report.mode, {
    tileX: settings.tile.x,
    tileY: settings.tile.y,
  });
  writeFileSync(out, encodePng(sheet.raster));
  print({ image: path, sheet: out, cells: sheet.cells, ...summary(report) });
  return 0;
}

function runFrame(path: string, values: Values): number {
  const name = required(values.name, '--name');
  const raster = decodePng(readFileSync(path));
  const report = inspectRaster(raster, inspectOptions(values, raster.width, raster.height));
  const out = values.out;
  const imageRef = out === undefined
    ? basename(path)
    : relative(dirname(resolve(out)), resolve(path));
  const atlas = createSingleFrameAtlas(name, imageRef, raster.width, raster.height, report.insets);
  if (out !== undefined) {
    writeFileSync(out, `${JSON.stringify(atlas, null, 2)}\n`);
  }
  print({ image: path, atlas: out ?? atlas, ...summary(report) });
  return report.ok ? 0 : 1;
}

function runAtlas(path: string, values: Values): number {
  const json: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const imagePath = values.image ?? resolve(dirname(path), atlasImage(json, path));
  const report: AtlasReport = inspectAtlas(
    json,
    decodePng(readFileSync(imagePath)),
    matchOptions(values),
    values.frame,
  );
  print({ atlas: path, image: imagePath, ...report });
  return report.ok ? 0 : 1;
}

function inspectOptions(values: Values, width: number, height: number): InspectOptions {
  const tile = values.tile ?? '';
  if (!/^(x|y|xy|yx)?$/.test(tile)) {
    throw new Error(`--tile takes x, y, or xy, got "${tile}".`);
  }
  if (values.insets !== undefined && values.borders !== undefined) {
    throw new Error('Give --insets or --borders, not both.');
  }
  const insets =
    values.insets !== undefined
      ? parseInsets(values.insets)
      : values.borders !== undefined
        ? scale9BordersToInsets(parseBorders(values.borders), width, height)
        : undefined;
  return {
    ...matchOptions(values),
    mode: oneOf(values.mode ?? 'auto', ['auto', 'nine', 'three'] as const, '--mode'),
    tile: { x: tile.includes('x'), y: tile.includes('y') },
    ...(insets === undefined ? {} : { insets }),
  };
}

function matchOptions(values: Values): InspectOptions {
  const tolerance = Number(values.tolerance ?? defaultInspectOptions.tolerance);
  const outlierRatio = Number(values['outlier-ratio'] ?? defaultInspectOptions.outlierRatio);
  if (!(tolerance >= 0 && tolerance <= 255)) {
    throw new Error('--tolerance must be between 0 and 255.');
  }
  if (!(outlierRatio >= 0 && outlierRatio < 1)) {
    throw new Error('--outlier-ratio must be at least 0 and below 1.');
  }
  return { ...defaultInspectOptions, tolerance, outlierRatio };
}

function atlasImage(json: unknown, path: string): string {
  if (typeof json === 'object' && json !== null && 'meta' in json) {
    const meta = (json as { meta?: { image?: unknown } }).meta;
    if (typeof meta?.image === 'string') {
      return meta.image;
    }
  }
  throw new Error(`${path} has no meta.image; pass --image.`);
}

function summary(report: InspectReport): {
  ok: boolean;
  mode: InspectReport['mode'];
  insets: InspectReport['insets'];
  scale9Borders: InspectReport['scale9Borders'];
  findings: readonly Finding[];
} {
  return {
    ok: report.ok,
    mode: report.mode,
    insets: report.insets,
    scale9Borders: report.scale9Borders,
    findings: report.findings,
  };
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], flag: string): T {
  if (value === undefined || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`${flag} must be one of ${allowed.join(', ')}.`);
  }
  return value as T;
}

function required(value: string | undefined, what: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing ${what}.\n\n${usage}`);
  }
  return value;
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`slicewright: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
