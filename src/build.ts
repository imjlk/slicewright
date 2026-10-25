import {
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import typia, { type tags } from 'typia';

import { defaultInspectOptions, type Finding, type InspectOptions } from './inspect.js';
import { compareSet } from './compare.js';
import { normalizeRaster, type NormalizeResult, type NormalizeStep } from './normalize.js';
import { buildPack, type PackFilesResult } from './pack-files.js';
import { defaultPackOptions } from './pack.js';
import { decodePng, encodePng } from './png.js';
import type { Raster } from './raster.js';
import { parseInsets, type SliceInsets, type SliceMode } from './slices.js';
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

/** States of one element that swap in place, checked together after normalizing. */
export interface BuildGroup {
  readonly name: string;
  /** Piece names, at least two. */
  readonly pieces: readonly string[] & tags.MinItems<2>;
  /** Largest inset or padding difference between states, in pixels; 1 by default. */
  readonly slack?: number & tags.Type<'uint32'>;
  /** Normalize every state again with the group's shared insets. */
  readonly sharedInsets?: boolean;
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
  /** States compared after normalizing; a mismatch fails the build. */
  readonly groups?: readonly BuildGroup[];
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

export interface BuildGroupReport {
  readonly name: string;
  readonly ok: boolean;
  readonly pieces: readonly string[];
  /** The largest inset on each side, or null when the states do not agree. */
  readonly sharedInsets: SliceInsets | null;
  /** Whether the pieces were normalized again with the shared insets. */
  readonly applied: boolean;
  readonly findings: readonly Finding[];
}

export interface BuildReport {
  readonly ok: boolean;
  readonly pieces: readonly BuildPieceReport[];
  readonly groups: readonly BuildGroupReport[];
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
 * @evidenceReview docs/spec.md#build-manifest #81ef4f6 Checked this code against the section line by line and ran buildsManifests green with pnpm test.
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
  const grouped = new Map<string, string>();
  const groupNames = new Set<string>();
  for (const group of manifest.groups ?? []) {
    if (groupNames.has(group.name)) {
      throw new BuildManifestError(`Two groups are named "${group.name}".`);
    }
    groupNames.add(group.name);
    for (const member of group.pieces) {
      const piece = manifest.pieces.find((item) => pieceName(item) === member);
      if (piece === undefined) {
        throw new BuildManifestError(`Group "${group.name}" names unknown piece "${member}".`);
      }
      const other = grouped.get(member);
      if (other !== undefined) {
        throw new BuildManifestError(
          `Piece "${member}" is in group "${other}"${other === group.name ? ' twice' : ` and "${group.name}"`}; a piece belongs to one group.`,
        );
      }
      grouped.set(member, group.name);
      // States are compared by detected geometry on one stretch region per axis.
      if (piece.insets !== undefined || piece.padding !== undefined) {
        throw new BuildManifestError(
          `Piece "${member}" in group "${group.name}" gives insets or padding; states are compared by detected ones.`,
        );
      }
      // Shared insets are measured on each state's normalized pixels; a resize would shift them per state.
      if (
        group.sharedInsets === true &&
        (piece.scale !== undefined || piece.width !== undefined || piece.height !== undefined)
      ) {
        throw new BuildManifestError(
          `Piece "${member}" in group "${group.name}" gives a scale or a size; shared insets need unresized states.`,
        );
      }
      if (piece.regions === 'multi') {
        throw new BuildManifestError(
          `Piece "${member}" in group "${group.name}" uses multi regions; groups compare single-region layouts.`,
        );
      }
    }
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
  // A hard link shares its file with an input under another real path.
  const inputFiles = [
    ...manifest.pieces.map((piece) => resolve(baseDir, piece.input)),
    ...protect.map((path) => resolve(path)),
  ]
    .map(fileIdentity)
    .filter((identity) => identity !== undefined);
  const overwrites = (path: string): boolean => {
    if (inputs.has(realPath(path))) {
      return true;
    }
    const identity = fileIdentity(path);
    return identity !== undefined && inputFiles.includes(identity);
  };
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
  // A write needs every existing parent to be a directory.
  for (const path of planned) {
    const blocked = fileAncestor(path);
    if (blocked !== undefined) {
      throw new BuildManifestError(
        `The build output ${path} needs ${blocked} to be a directory, but it is a file.`,
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

  const loaded = manifest.pieces.map((piece) => {
    const source = decodePng(readFileSync(resolve(baseDir, piece.input)));
    return { source, result: normalizePiece(piece, source) };
  });
  const sources = loaded.map((item) => item.source);
  const results = loaded.map((item) => item.result);
  const groups = checkGroups(manifest, sources, results);

  const pieces = manifest.pieces.map((piece, index): BuildPieceReport => {
    const name = pieceName(piece);
    const input = resolve(baseDir, piece.input);
    const result = results[index];
    if (result === undefined) {
      throw new Error(`Piece "${name}" was not normalized.`);
    }
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

  if (!pieces.every((piece) => piece.ok) || !groups.every((group) => group.ok)) {
    return { ok: false, pieces, groups, pack: null, files };
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
    groups,
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

function normalizePiece(
  piece: BuildPiece,
  source: Raster,
  insets?: SliceInsets,
  tile?: { readonly x: boolean; readonly y: boolean },
  mode?: SliceMode,
): NormalizeResult {
  return normalizeRaster(source, {
    inspect: {
      ...pieceInspectOptions(piece),
      ...(insets === undefined ? {} : { insets }),
      ...(tile === undefined ? {} : { tile: { x: tile.x, y: tile.y } }),
      ...(mode === undefined || mode === 'multi' ? {} : { mode }),
    },
    crop: piece.crop !== false,
    filter: piece.filter ?? 'area',
    ...(piece.width === undefined ? {} : { width: piece.width }),
    ...(piece.height === undefined ? {} : { height: piece.height }),
    ...(piece.scale === undefined ? {} : { scale: piece.scale }),
    ...(piece.keep === undefined ? {} : { keep: piece.keep }),
  });
}

/**
 * Compares each group's normalized pieces as states of one element, and with
 * `sharedInsets` normalizes them again with the group's shared insets,
 * replacing their results in place. A group fails on any error finding of
 * the comparison or, once applied, of a piece normalized again.
 *
 * @evidence docs/spec.md#build-groups Compares each group's normalized states, fails on a mismatch, and applies the shared insets by normalizing again.
 * @evidenceReview docs/spec.md#build-groups #5024de0 Checked this code against the section line by line and ran buildsGroups green with pnpm test.
 */
export function checkGroups(
  manifest: BuildManifest,
  sources: readonly Raster[],
  results: NormalizeResult[],
): BuildGroupReport[] {
  return (manifest.groups ?? []).map((group) => {
    const members = group.pieces.map((member) => {
      const index = manifest.pieces.findIndex((piece) => pieceName(piece) === member);
      const piece = manifest.pieces[index];
      const result = results[index];
      const source = sources[index];
      if (piece === undefined || result === undefined || source === undefined) {
        throw new BuildManifestError(`Group "${group.name}" names unknown piece "${member}".`);
      }
      return { index, piece, result, source, name: member };
    });
    const first = members[0]?.piece;
    const compared = compareSet(
      members.map((member) => ({ name: member.name, raster: member.result.raster })),
      {
        kind: 'states',
        slack: group.slack ?? 1,
        inspect: first === undefined ? defaultInspectOptions : pieceInspectOptions(first),
      },
    );
    const findings: Finding[] = [...compared.findings];
    let ok = compared.ok;
    const layouts = members.map((member) => ({
      piece: member.name,
      mode: member.result.report.mode,
      tile: member.result.report.tile,
    }));
    const layoutKey = (layout: (typeof layouts)[number]): string =>
      `${layout.mode}:${layout.tile.x},${layout.tile.y}`;
    if (new Set(layouts.map(layoutKey)).size > 1) {
      ok = false;
      findings.push({
        code: 'build.group-layout',
        severity: 'error',
        message: `Pieces of group "${group.name}" export different slice modes or tile axes.`,
        details: { group: group.name, layouts },
      });
    }
    // Normalization keeps the geometry it verified even when `keep` shortens
    // the stretch spans, so shared insets come from those reports rather than
    // from detecting again on the shortened rasters.
    const shared: SliceInsets | null =
      compared.sharedInsets === null
        ? null
        : {
            left: Math.max(...members.map((member) => member.result.report.insets.left)),
            right: Math.max(...members.map((member) => member.result.report.insets.right)),
            top: Math.max(...members.map((member) => member.result.report.insets.top)),
            bottom: Math.max(...members.map((member) => member.result.report.insets.bottom)),
          };
    const applied = ok && group.sharedInsets === true && shared !== null;
    if (applied) {
      for (const member of members) {
        const again = normalizePiece(
          member.piece,
          member.source,
          shared,
          member.result.report.tile,
          member.result.report.mode,
        );
        results[member.index] = again;
        if (!again.report.ok) {
          ok = false;
          findings.push({
            code: 'build.group-shared-insets',
            severity: 'error',
            message: `Piece "${member.name}" has errors with the shared insets of group "${group.name}".`,
            details: { piece: member.name, group: group.name },
          });
        }
      }
      const sizes = members.map((member) => {
        const raster = results[member.index]?.raster;
        return { piece: member.name, width: raster?.width ?? 0, height: raster?.height ?? 0 };
      });
      if (new Set(sizes.map((size) => `${size.width}x${size.height}`)).size > 1) {
        ok = false;
        findings.push({
          code: 'build.group-size',
          severity: 'error',
          message: `Pieces of group "${group.name}" end up different sizes with the shared insets.`,
          details: { group: group.name, sizes },
        });
      }
    }
    return {
      name: group.name,
      ok,
      pieces: [...group.pieces],
      sharedInsets: shared,
      applied,
      findings,
    };
  });
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
function realPath(path: string, depth = 0): string {
  const absolute = resolve(path);
  let base = absolute;
  const rest: string[] = [];
  while (dirname(base) !== base) {
    try {
      return join(realpathSync(base), ...rest).toLowerCase();
    } catch {
      // A dangling symlink still decides where a write through it lands.
      const link = depth < maximumLinks ? linkTarget(base) : undefined;
      if (link !== undefined) {
        return realPath(join(link, ...rest), depth + 1);
      }
      rest.unshift(basename(base));
      base = dirname(base);
    }
  }
  return absolute.toLowerCase();
}

/** Symlinks followed before a path is taken as it is, as the system's own loop limit. */
const maximumLinks = 40;

/** Where a symlink points, resolved against its directory, or undefined when it is not one. */
function linkTarget(path: string): string | undefined {
  try {
    return resolve(dirname(path), readlinkSync(path));
  } catch {
    return undefined;
  }
}

/** Device and inode of an existing file, so hard links compare equal. */
function fileIdentity(path: string): string | undefined {
  try {
    const stats = statSync(path, { bigint: true });
    // Some file systems report no inode; then only real paths compare.
    return stats.ino === 0n ? undefined : `${stats.dev}:${stats.ino}`;
  } catch {
    return undefined;
  }
}

/** The nearest existing parent of `path` when it is not a directory. */
function fileAncestor(path: string): string | undefined {
  let directory = dirname(resolve(path));
  while (dirname(directory) !== directory) {
    try {
      return statSync(directory).isDirectory() ? undefined : directory;
    } catch (error) {
      // A link in the path that leads through a file blocks it as well.
      if ((error as NodeJS.ErrnoException).code === 'ENOTDIR') {
        return directory;
      }
      directory = dirname(directory);
    }
  }
  return undefined;
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
