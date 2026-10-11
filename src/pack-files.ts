import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import type { Finding, InspectOptions } from './inspect.js';
import { axisTiles, type SliceLayout } from './layout.js';
import { packFrames, type PackedFrame, type PackOptions, type PackPiece } from './pack.js';
import { frameLayout, inspectAtlas, readAtlas, type AtlasReport } from './phaser.js';
import { decodePng, encodePng } from './png.js';
import { cropRaster } from './raster.js';
import { fixedAxisNote, urlFromPath } from './targets/common.js';
import { cssIdentifier } from './targets/css.js';
import { exportForTarget } from './targets/index.js';
import { phaserUsage } from './targets/phaser.js';

export interface PackFilesOptions extends PackOptions {
  /** Atlas JSON files whose frames are packed, in order. */
  readonly inputs: readonly string[];
  /** The packed PNG; the atlas and stylesheet go next to it. */
  readonly out: string;
  /** Texture key and file name for the atlas and stylesheet. */
  readonly name: string;
  readonly css: boolean;
  readonly match: InspectOptions;
  /** Where the game is served from; loader paths in the usage are relative to it. */
  readonly servedFrom: string;
}

export interface PackedFile {
  readonly path: string;
  readonly contents: string | Uint8Array;
}

export interface PackFilesResult {
  /** The PNG, the atlas, and the stylesheet when asked for; nothing is written. */
  readonly files: readonly PackedFile[];
  readonly frames: readonly PackedFrame[];
  readonly size: { readonly width: number; readonly height: number };
  readonly report: AtlasReport;
  readonly cssFindings: readonly Finding[];
  readonly ok: boolean;
  readonly usage: string;
}

/** An input the packer cannot use; the CLI reports it as a usage error. */
export class PackInputError extends Error {}

interface AtlasSource {
  readonly piece: PackPiece;
  /** The frame's layout, when it has scale9Borders that fit it. */
  readonly layout: SliceLayout | undefined;
  /** The frame's own image, when the frame covers all of it. */
  readonly wholeImage: string | undefined;
  /** The image the frame is cut from. */
  readonly image: string;
}

/**
 * Reads the input atlases and their images, packs every frame, checks the
 * packed atlas, and returns the files to write with the usage. Paths inside
 * the files are relative to the output directory, as the atlas and
 * stylesheet sit next to the PNG.
 *
 * @evidence docs/spec.md#atlas-packing Refuses trimmed, rotated, and out-of-image input frames, checks the packed atlas, writes one load call with a NineSlice per frame, and gives CSS classes only to frames that are a whole image.
 * @evidenceReview docs/spec.md#atlas-packing #cd28666 Checked this code against the section line by line and ran packsAtlasFiles green with pnpm test.
 */
export function buildPack(options: PackFilesOptions): PackFilesResult {
  const outDir = dirname(options.out);
  const atlasPath = join(outDir, `${options.name}.json`);
  const cssPath = join(outDir, `${options.name}.css`);
  const sources = options.inputs.flatMap((path) => atlasSources(path));
  // Packing next to its inputs must never overwrite them or their stylesheets.
  // Existing files compare by their real path, so a symlink or another letter
  // case on a case-insensitive disk still names the same file.
  const outputs = [options.out, atlasPath, cssPath].map((path) => filePath(path));
  if (new Set(outputs).size !== outputs.length) {
    throw new PackInputError(
      `--out ${options.out} is also the atlas or stylesheet path for --name ${options.name}; give the image a .png name.`,
    );
  }
  for (const input of options.inputs) {
    const stem = resolve(input).replace(/\.json$/i, '');
    const taken = [input, `${stem}.css`, `${stem}.png`].map((path) => filePath(path));
    const clash = outputs.find((path) => taken.includes(path));
    if (clash !== undefined) {
      throw new PackInputError(
        `Packing would overwrite ${clash}, which belongs to the input ${input}; pick another --out or --name.`,
      );
    }
  }
  for (const source of sources) {
    const clash = outputs.find((path) => path === filePath(source.image));
    if (clash !== undefined) {
      throw new PackInputError(
        `Packing would overwrite the input image ${clash}; pick another --out.`,
      );
    }
  }
  const packed = packFrames(
    sources.map(({ piece }) => piece),
    urlPath(relative(resolve(outDir), resolve(options.out))),
    { spacing: options.spacing, extrude: options.extrude },
  );
  const report = inspectAtlas(packed.atlas, packed.raster, options.match);
  const served = (path: string): string => urlPath(relative(options.servedFrom, resolve(path)));
  const usage = phaserUsage(
    options.name,
    served(options.out),
    served(atlasPath),
    sources.flatMap(({ piece, layout }) =>
      layout === undefined
        ? [
            {
              name: piece.name,
              plain: true,
              tile: { x: false, y: false },
              note: '',
              contentPadding: false,
            },
          ]
        : [
            {
              name: piece.name,
              tile: { x: axisTiles(layout.x), y: axisTiles(layout.y) },
              note: fixedAxisNote(layout),
              contentPadding: layout.content !== undefined,
            },
          ],
    ),
  );
  const css = options.css ? packedCss(sources, outDir, served(cssPath)) : undefined;
  return {
    files: [
      { path: options.out, contents: encodePng(packed.raster) },
      { path: atlasPath, contents: `${JSON.stringify(packed.atlas, null, 2)}\n` },
      // A stylesheet with no class would only be an empty file to link.
      ...(css === undefined || css.contents === '' ? [] : [{ path: cssPath, contents: css.contents }]),
    ],
    frames: packed.frames,
    size: { width: packed.raster.width, height: packed.raster.height },
    report,
    cssFindings: css?.findings ?? [],
    ok: report.ok && (css?.ok ?? true),
    usage: css === undefined || css.contents === '' ? usage : `${usage}\n\n${css.usage}`,
  };
}

/** Reads an atlas and its image and cuts out every frame. */
function atlasSources(path: string): AtlasSource[] {
  const json: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const { atlas, entries } = readAtlas(json);
  if (atlas.meta?.image === undefined) {
    throw new PackInputError(`${path} has no meta.image.`);
  }
  const imagePath = resolve(dirname(path), atlas.meta.image);
  const raster = decodePng(readFileSync(imagePath));
  return entries.map(([name, frame]) => {
    const { x, y, w, h } = frame.frame;
    if (frame.trimmed === true || frame.rotated === true) {
      throw new PackInputError(
        `Frame "${name}" in ${path} is ${frame.trimmed === true ? 'trimmed' : 'rotated'}; repack it untrimmed and unrotated first.`,
      );
    }
    if (![x, y, w, h].every(Number.isInteger)) {
      throw new PackInputError(`Frame "${name}" in ${path} has a fractional rectangle ${JSON.stringify(frame.frame)}.`);
    }
    if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > raster.width || y + h > raster.height) {
      throw new PackInputError(
        `Frame "${name}" in ${path} lies outside its ${raster.width}x${raster.height} image.`,
      );
    }
    const borders = frame.scale9Borders;
    const bordersFit =
      borders !== undefined &&
      borders.x >= 0 &&
      borders.y >= 0 &&
      borders.w > 0 &&
      borders.h > 0 &&
      borders.x + borders.w <= w &&
      borders.y + borders.h <= h;
    return {
      piece: {
        name,
        raster: cropRaster(raster, { x, y, width: w, height: h }),
        data: {
          ...(borders === undefined ? {} : { scale9Borders: borders }),
          ...(frame.slicewright === undefined ? {} : { slicewright: frame.slicewright }),
        },
      },
      layout: bordersFit ? frameLayout(frame) : undefined,
      wholeImage:
        x === 0 && y === 0 && w === raster.width && h === raster.height ? imagePath : undefined,
      image: imagePath,
    };
  });
}

/**
 * One stylesheet with a class per frame. CSS border-image cannot address part
 * of an image, so each class points at the frame's own image, and a frame that
 * is only part of its image gets no class.
 */
function packedCss(
  sources: readonly AtlasSource[],
  outDir: string,
  href: string,
): { ok: boolean; contents: string; usage: string; findings: readonly Finding[] } {
  const findings: Finding[] = [];
  const blocks: string[] = [];
  const classes: string[] = [];
  for (const { piece, layout, wholeImage } of sources) {
    if (layout === undefined || wholeImage === undefined) {
      findings.push({
        code: 'pack.css-skipped',
        severity: 'info',
        message:
          layout === undefined
            ? `Frame "${piece.name}" has no usable scale9Borders, so it has no CSS class.`
            : `Frame "${piece.name}" is only part of its image, which border-image cannot address, so it has no CSS class.`,
      });
      continue;
    }
    const result = exportForTarget('css', {
      name: piece.name,
      imageRef: urlPath(relative(resolve(outDir), wholeImage)),
      raster: piece.raster,
      layout,
    });
    findings.push(
      ...result.findings.map((finding) => ({ ...finding, message: `${piece.name}: ${finding.message}` })),
    );
    const className = cssIdentifier(piece.name);
    if (classes.includes(className)) {
      findings.push({
        code: 'pack.css-class-collision',
        severity: 'error',
        message: `Frames "${piece.name}" and another frame both become the CSS class .${className}; rename one.`,
      });
      continue;
    }
    const contents = result.files[0]?.contents;
    if (typeof contents === 'string') {
      blocks.push(contents);
      classes.push(className);
    }
  }
  return {
    ok: !findings.some((finding) => finding.severity === 'error'),
    contents: blocks.join('\n'),
    usage: [
      `<link rel="stylesheet" href="${urlFromPath(href).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`,
      ...classes.map((className) => `<div class="${className}">…</div>`),
    ].join('\n'),
    findings,
  };
}

/** The real path of an existing file, so links and letter case resolve; otherwise the absolute path. */
function filePath(path: string): string {
  return existsSync(path) ? realpathSync.native(path) : resolve(path);
}

/** A path as a URL-style reference: forward slashes on every platform. */
function urlPath(path: string): string {
  return path.split(sep).join('/').replace(/\\/g, '/');
}
