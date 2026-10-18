import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import typia, { type tags } from 'typia';

import { defaultInspectOptions, type Finding, type InspectOptions } from './inspect.js';
import { normalizeRaster, type NormalizeStep } from './normalize.js';
import { buildPack, type PackFilesResult } from './pack-files.js';
import { defaultPackOptions } from './pack.js';
import { decodePng, encodePng } from './png.js';
import { parseInsets, type SliceInsets } from './slices.js';
import { exportForTarget, findTarget, sliceTargets } from './targets/index.js';

/** One piece of a build: a PNG and how to normalize it. */
export interface BuildPiece {
  /** PNG to normalize, relative to the manifest. */
  readonly input: string;
  /** Frame name and file name of the normalized piece; defaults to the input's file name. */
  readonly name?: string;
  readonly width?: number & tags.Type<'uint32'> & tags.Minimum<1>;
  readonly height?: number & tags.Type<'uint32'> & tags.Minimum<1>;
  readonly scale?: number & tags.ExclusiveMinimum<0>;
  readonly filter?: 'area' | 'nearest';
  /** Crop transparent margins first; true by default. */
  readonly crop?: boolean;
  /** Rebuild keeping this many pixels of each uniform stretch span. */
  readonly keep?: number & tags.Type<'uint32'> & tags.Minimum<1>;
  /** Insets as `l,r,t,b`, `h,v`, or `n`, instead of detecting them. */
  readonly insets?: string;
  /** Content padding as `l,r,t,b`, `h,v`, or `n`, instead of detecting it. */
  readonly padding?: string;
  readonly mode?: 'auto' | 'nine' | 'three' | 'three-vertical';
  /** `multi` keeps every long stretch run on an axis, around fixed detail. */
  readonly regions?: 'single' | 'multi';
  readonly tile?: 'x' | 'y' | 'xy';
  readonly tolerance?: number & tags.Minimum<0> & tags.Maximum<255>;
  readonly outlierRatio?: number & tags.Minimum<0> & tags.ExclusiveMaximum<1>;
  readonly noise?: 'auto' | 'off';
  /** Export targets written next to the normalized piece. */
  readonly targets?: readonly string[];
}

/** A `slicewright build` manifest: pieces normalized, exported, and packed into one atlas. */
export interface BuildManifest {
  /** The packed PNG, relative to the manifest; its atlas goes next to it. */
  readonly out: string;
  /** Texture key and file name of the atlas and stylesheet; defaults to the PNG name. */
  readonly name?: string;
  /** Where normalized pieces go, relative to the manifest; defaults to `pieces` beside `out`. */
  readonly piecesDir?: string;
  /** Also write one stylesheet with a class per piece. */
  readonly css?: boolean;
  readonly spacing?: number & tags.Type<'uint32'> & tags.Maximum<64>;
  readonly extrude?: number & tags.Type<'uint32'> & tags.Maximum<64>;
  readonly pieces: readonly BuildPiece[] & tags.MinItems<1>;
}

/** A manifest that parses but cannot be built; the CLI reports it as a usage error. */
export class BuildManifestError extends Error {}

export interface BuildPieceReport {
  readonly name: string;
  readonly input: string;
  readonly image: string;
  readonly atlas: string | undefined;
  readonly ok: boolean;
  readonly steps: readonly NormalizeStep[];
  readonly mode: string;
  readonly insets: SliceInsets;
  readonly contentPadding: SliceInsets | null;
  readonly minSize: { readonly width: number; readonly height: number };
  readonly findings: readonly Finding[];
  readonly exports: ReadonlyArray<{
    readonly target: string;
    readonly ok: boolean;
    readonly files: readonly string[];
    readonly findings: readonly Finding[];
  }>;
}

export interface BuildReport {
  readonly ok: boolean;
  readonly pieces: readonly BuildPieceReport[];
  /** The pack, or null when a piece failed and nothing was packed. */
  readonly pack: {
    readonly ok: boolean;
    readonly files: readonly string[];
    readonly size: PackFilesResult['size'];
    readonly frames: PackFilesResult['frames'];
    readonly findings: readonly Finding[];
    readonly frameFindings: ReadonlyArray<{
      readonly name: string;
      readonly ok: boolean;
      readonly findings: readonly Finding[];
    }>;
    readonly cssFindings: readonly Finding[];
    readonly usage: string;
  } | null;
  /** Every file written, in order. */
  readonly files: readonly string[];
}

/**
 * Validates a parsed manifest: its shape with typia, then what the shape
 * cannot say. Piece names must be unique plain file names, a piece takes a
 * scale or a size, and every target must exist.
 *
 * @evidence docs/spec.md#build-manifest Validates the manifest shape, unique plain piece names, size or scale, insets syntax, and known targets before anything is built.
 * @evidenceReview docs/spec.md#build-manifest #59f064c Checked this code against the section line by line and ran buildsManifests green with pnpm test.
 */
export function readBuildManifest(json: unknown): BuildManifest {
  // Unknown keys are refused, so a misspelled setting is not silently ignored.
  const manifest = typia.assertEquals<BuildManifest>(json);
  // No file system takes a NUL in a path; refuse it before anything is written.
  for (const path of [manifest.out, manifest.piecesDir, ...manifest.pieces.map((p) => p.input)]) {
    if (path?.includes('\0') === true) {
      throw new BuildManifestError(`The path ${JSON.stringify(path)} contains a NUL character.`);
    }
  }
  const names = manifest.pieces.map(pieceName);
  for (const name of [...names, manifest.name ?? stem(manifest.out)]) {
    if (!plainName(name)) {
      throw new BuildManifestError(`"${name}" must be a plain file name without path separators.`);
    }
  }
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name.toLowerCase())) {
      throw new BuildManifestError(`Two pieces are named "${name}"; give one a name.`);
    }
    seen.add(name.toLowerCase());
  }
  manifest.pieces.forEach((piece, index) => {
    const label = names[index] ?? piece.input;
    if (piece.scale !== undefined && (piece.width !== undefined || piece.height !== undefined)) {
      throw new BuildManifestError(`Piece "${label}" gives scale and a size; give one.`);
    }
    if (piece.regions === 'multi' && piece.insets !== undefined) {
      throw new BuildManifestError(`Piece "${label}" gives insets with multi regions; give one.`);
    }
    for (const field of ['insets', 'padding'] as const) {
      const text = piece[field];
      if (text !== undefined) {
        try {
          parseInsets(text);
        } catch (error) {
          throw new BuildManifestError(
            `Piece "${label}" ${field}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
    for (const target of piece.targets ?? []) {
      if (findTarget(target) === undefined) {
        throw new BuildManifestError(
          `Piece "${label}" names unknown target "${target}". Known targets: ${Object.keys(sliceTargets).join(', ')}.`,
        );
      }
    }
  });
  return manifest;
}

/** Reads and validates a manifest file. */
export function loadBuildManifest(path: string): BuildManifest {
  return readBuildManifest(JSON.parse(readFileSync(path, 'utf8')));
}

/** The files a build reads: the manifest and every piece's input, as absolute paths. */
export function buildInputs(manifest: BuildManifest, manifestPath: string): string[] {
  const base = dirname(resolve(manifestPath));
  return [resolve(manifestPath), ...manifest.pieces.map((piece) => resolve(base, piece.input))];
}

/**
 * Normalizes every piece, writes it with a one-frame atlas and its exports,
 * then packs the pieces into one atlas. Paths in the manifest are relative to
 * `baseDir`. Nothing is packed when a piece fails.
 */
export function runBuild(
  manifest: BuildManifest,
  baseDir: string,
  servedFrom: string = process.cwd(),
  /** More files the build must never write over, such as the manifest itself. */
  protect: readonly string[] = [],
): BuildReport {
  const out = resolve(baseDir, manifest.out);
  const piecesDir = resolve(baseDir, manifest.piecesDir ?? join(dirname(manifest.out), 'pieces'));
  const packName = manifest.name ?? stem(manifest.out);
  const files: string[] = [];
  // Sources compare by real path and letter case, as packing compares its inputs.
  const inputs = new Set([
    ...manifest.pieces.map((piece) => realPath(resolve(baseDir, piece.input))),
    ...protect.map((path) => realPath(resolve(path))),
  ]);
  const planned = [
    out,
    join(dirname(out), `${packName}.json`),
    ...(manifest.css === true ? [join(dirname(out), `${packName}.css`)] : []),
    ...manifest.pieces.flatMap((piece) => [
      join(piecesDir, `${pieceName(piece)}.png`),
      join(piecesDir, `${pieceName(piece)}.json`),
      // Every file a target may write, as its export declares them; the atlas is already above.
      ...[...new Set(piece.targets ?? [])]
        .filter((target) => target !== 'phaser')
        .flatMap((target) => findTarget(target)?.outputs(pieceName(piece)) ?? [])
        .map((file) => join(piecesDir, file)),
    ]),
  ];
  const overwrites = (path: string): boolean => inputs.has(realPath(path));
  const clash = planned.find(overwrites);
  if (clash !== undefined) {
    throw new BuildManifestError(`The build would write over its input ${clash}.`);
  }
  // A piece written where the pack goes would be packed over, or refused as the pack's input.
  const seen = new Set<string>();
  for (const path of planned) {
    if (seen.has(realPath(path))) {
      throw new BuildManifestError(
        `Two build outputs are ${path}; give the pack or the piece another name, or another piecesDir.`,
      );
    }
    seen.add(realPath(path));
  }
  // A file cannot also be a directory another output goes into, or one already there.
  for (const path of planned) {
    const file = realPath(path);
    const inside = [...seen].find((other) => other.startsWith(`${file}${sep}`));
    if (inside !== undefined || isDirectory(path)) {
      throw new BuildManifestError(
        `The build output ${path} is ${inside === undefined ? 'a directory' : 'also a directory of another output'}; pick another out or piecesDir.`,
      );
    }
  }
  const write = (path: string, contents: string | Uint8Array): string => {
    if (overwrites(path)) {
      throw new BuildManifestError(`The build would write over its input ${path}.`);
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
    files.push(path);
    return path;
  };

  const pieces = manifest.pieces.map((piece): BuildPieceReport => {
    const name = pieceName(piece);
    const input = resolve(baseDir, piece.input);
    const result = normalizeRaster(decodePng(readFileSync(input)), {
      inspect: pieceInspectOptions(piece),
      crop: piece.crop !== false,
      filter: piece.filter ?? 'area',
      ...(piece.width === undefined ? {} : { width: piece.width }),
      ...(piece.height === undefined ? {} : { height: piece.height }),
      ...(piece.scale === undefined ? {} : { scale: piece.scale }),
      ...(piece.keep === undefined ? {} : { keep: piece.keep }),
    });
    const image = write(join(piecesDir, `${name}.png`), encodePng(result.raster));
    const exportInput = {
      name,
      imageRef: `${name}.png`,
      raster: result.raster,
      layout: result.report.layout,
      loaderPaths: {
        image: urlPath(relative(servedFrom, image)),
        directory: urlPath(relative(servedFrom, piecesDir)),
      },
    };
    // The one-frame atlas is what packing reads.
    const phaser = exportForTarget('phaser', exportInput);
    const atlasFile = phaser.files[0];
    const atlasOk = !phaser.findings.some((finding) => finding.severity === 'error');
    const atlas =
      atlasOk && atlasFile !== undefined
        ? write(join(piecesDir, atlasFile.path), atlasFile.contents)
        : undefined;
    const exports = (piece.targets ?? [])
      .filter((target) => target !== 'phaser')
      .map((target) => {
        const exported = exportForTarget(target, exportInput);
        return {
          target,
          ok: !exported.findings.some((finding) => finding.severity === 'error'),
          files: exported.files.map((file) => write(join(piecesDir, file.path), file.contents)),
          findings: exported.findings,
        };
      });
    const report = result.report;
    return {
      name,
      input,
      image,
      atlas,
      ok: report.ok && atlas !== undefined && exports.every((item) => item.ok),
      steps: result.steps,
      mode: report.mode,
      insets: report.insets,
      contentPadding: report.contentPadding,
      minSize: report.minSize,
      findings: [...report.findings, ...phaser.findings],
      exports,
    };
  });

  if (!pieces.every((piece) => piece.ok)) {
    return { ok: false, pieces, pack: null, files };
  }
  const packed = buildPack({
    inputs: pieces.flatMap((piece) => (piece.atlas === undefined ? [] : [piece.atlas])),
    out,
    name: packName,
    css: manifest.css === true,
    spacing: manifest.spacing ?? defaultPackOptions.spacing,
    extrude: manifest.extrude ?? defaultPackOptions.extrude,
    match: packMatch(manifest.pieces),
    servedFrom,
  });
  const packFiles = packed.files.map((file) => write(file.path, file.contents));
  return {
    ok: packed.ok,
    pieces,
    pack: {
      ok: packed.ok,
      files: packFiles,
      size: packed.size,
      frames: packed.frames,
      findings: packed.report.findings,
      frameFindings: packed.report.frames.map((frame) => ({
        name: frame.name,
        ok: frame.ok,
        findings: [...frame.findings, ...(frame.inspection?.findings ?? [])],
      })),
      cssFindings: packed.cssFindings,
      usage: packed.usage,
    },
    files,
  };
}

/**
 * The matching the packed atlas is checked with: each piece already passed its
 * own settings and packing copies its pixels exactly, so the most lenient
 * settings any piece used keep the pack check from refusing an accepted piece.
 */
function packMatch(pieces: readonly BuildPiece[]): InspectOptions {
  const options = pieces.map(pieceInspectOptions);
  return {
    ...defaultInspectOptions,
    tolerance: Math.max(...options.map((option) => option.tolerance)),
    outlierRatio: Math.max(...options.map((option) => option.outlierRatio)),
    noise: options.some((option) => option.noise === 'auto') ? 'auto' : 'off',
  };
}

function pieceInspectOptions(piece: BuildPiece): InspectOptions {
  const tile = piece.tile ?? '';
  return {
    ...defaultInspectOptions,
    tolerance: piece.tolerance ?? defaultInspectOptions.tolerance,
    outlierRatio: piece.outlierRatio ?? defaultInspectOptions.outlierRatio,
    noise: piece.noise ?? 'auto',
    mode: piece.mode ?? 'auto',
    regions: piece.regions ?? 'single',
    tile: { x: tile.includes('x'), y: tile.includes('y') },
    ...(piece.insets === undefined ? {} : { insets: parseInsets(piece.insets) }),
    ...(piece.padding === undefined ? {} : { contentPadding: parseInsets(piece.padding) }),
  };
}

/**
 * A path as it names a file, in lower case for case-insensitive disks: its
 * nearest existing ancestor resolved through symlinks, then the rest, so a new
 * file under a symlinked directory names the same file as through its target.
 */
function realPath(path: string): string {
  const absolute = resolve(path);
  let base = absolute;
  const rest: string[] = [];
  while (dirname(base) !== base) {
    try {
      return join(realpathSync(base), ...rest).toLowerCase();
    } catch {
      rest.unshift(basename(base));
      base = dirname(base);
    }
  }
  return absolute.toLowerCase();
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function pieceName(piece: BuildPiece): string {
  return piece.name ?? stem(piece.input);
}

function stem(path: string): string {
  return basename(path).replace(/\.png$/i, '');
}

function plainName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !/[/\\\0]/.test(name);
}

function urlPath(path: string): string {
  return path.split(sep).join('/');
}
