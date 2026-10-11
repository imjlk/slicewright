import typia from 'typia';

import { inspectRaster, type Finding, type InspectOptions, type InspectReport } from './inspect.js';
import { cropRaster, type Raster } from './raster.js';
import {
  insetsToScale9Borders,
  scale9BordersToInsets,
  type Scale9Borders,
  type SliceInsets,
} from './slices.js';

export interface PhaserFrameRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface PhaserAtlasFrame {
  readonly frame: PhaserFrameRect;
  readonly rotated?: boolean;
  readonly trimmed?: boolean;
  readonly spriteSourceSize?: PhaserFrameRect;
  readonly sourceSize?: { readonly w: number; readonly h: number };
  readonly scale9Borders?: Scale9Borders;
}

export interface PhaserAtlasMeta {
  readonly image?: string;
  readonly size?: { readonly w: number; readonly h: number };
  readonly scale?: string | number;
}

/** TexturePacker "Phaser (JSONHash)". */
export interface PhaserJsonHashAtlas {
  readonly frames: Readonly<Record<string, PhaserAtlasFrame>>;
  readonly meta?: PhaserAtlasMeta;
}

/** TexturePacker "Phaser (JSONArray)". */
export interface PhaserJsonArrayAtlas {
  readonly frames: ReadonlyArray<PhaserAtlasFrame & { readonly filename: string }>;
  readonly meta?: PhaserAtlasMeta;
}

export type PhaserAtlas = PhaserJsonHashAtlas | PhaserJsonArrayAtlas;

export interface AtlasFrameReport {
  readonly name: string;
  readonly ok: boolean;
  readonly findings: readonly Finding[];
  readonly inspection?: InspectReport;
}

export interface AtlasReport {
  readonly ok: boolean;
  readonly format: 'hash' | 'array';
  readonly frames: readonly AtlasFrameReport[];
  readonly findings: readonly Finding[];
}

/**
 * Writes a one-frame JSON Hash atlas so a single image loads with
 * `this.load.atlas(key, image, json)` and NineSlice reads its borders.
 *
 * @evidence docs/spec.md#phaser-scale9borders Emits an untrimmed, unrotated JSON Hash frame carrying scale9Borders.
 * @evidenceReview docs/spec.md#phaser-scale9borders #649e388 Checked this code against the section line by line and ran convertsToPhaserBorders green with pnpm test.
 */
export function createSingleFrameAtlas(
  name: string,
  image: string,
  width: number,
  height: number,
  insets: SliceInsets,
): PhaserJsonHashAtlas {
  const rect = { x: 0, y: 0, w: width, h: height };
  return {
    frames: {
      [name]: {
        frame: rect,
        rotated: false,
        trimmed: false,
        spriteSourceSize: rect,
        sourceSize: { w: width, h: height },
        scale9Borders: insetsToScale9Borders(insets, width, height),
      },
    },
    meta: { image, size: { w: width, h: height }, scale: '1' },
  };
}

/**
 * Validates the atlas shape, then checks every frame with scale9Borders, or
 * only `frameName`, against the atlas image.
 *
 * @evidence docs/spec.md#atlas-frames Rejects trimmed frames and out-of-frame borders, warns on rotation, and inspects each frame with its borders.
 * @evidenceReview docs/spec.md#atlas-frames #879cca2 Checked this code against the section line by line and ran checksAtlasFrames green with pnpm test.
 */
export function inspectAtlas(
  json: unknown,
  image: Raster,
  options: InspectOptions,
  frameName?: string,
): AtlasReport {
  const atlas = typia.assert<PhaserAtlas>(json);
  const format = Array.isArray(atlas.frames) ? 'array' : 'hash';
  const entries: Array<[string, PhaserAtlasFrame]> = Array.isArray(atlas.frames)
    ? (atlas as PhaserJsonArrayAtlas).frames.map((frame) => [frame.filename, frame])
    : Object.entries((atlas as PhaserJsonHashAtlas).frames);
  const findings: Finding[] = [];

  if (
    atlas.meta?.size !== undefined &&
    (atlas.meta.size.w !== image.width || atlas.meta.size.h !== image.height)
  ) {
    findings.push({
      code: 'atlas.size-mismatch',
      severity: 'warning',
      message: `meta.size is ${atlas.meta.size.w}x${atlas.meta.size.h} but the image is ${image.width}x${image.height}.`,
    });
  }

  const selected = entries.filter(([name, frame]) =>
    frameName === undefined ? frame.scale9Borders !== undefined : name === frameName,
  );
  if (frameName !== undefined && selected.length === 0) {
    findings.push({
      code: 'atlas.frame-missing',
      severity: 'error',
      message: `Frame "${frameName}" is not in the atlas.`,
    });
  }
  if (frameName === undefined && selected.length === 0) {
    findings.push({
      code: 'atlas.no-slices',
      severity: 'info',
      message: 'No frame carries scale9Borders.',
    });
  }

  const frames = selected.map(([name, frame]) => inspectFrame(name, frame, image, options));
  return {
    ok:
      !findings.some((finding) => finding.severity === 'error') &&
      frames.every((frame) => frame.ok),
    format,
    frames,
    findings,
  };
}

function inspectFrame(
  name: string,
  frame: PhaserAtlasFrame,
  image: Raster,
  options: InspectOptions,
): AtlasFrameReport {
  const findings: Finding[] = [];
  const { x, y, w, h } = frame.frame;
  if (frame.trimmed === true) {
    findings.push({
      code: 'atlas.trimmed',
      severity: 'error',
      message: 'Phaser NineSlice does not support trimmed frames; disable trimming for this sprite.',
    });
  }
  if (frame.rotated === true) {
    findings.push({
      code: 'atlas.rotated',
      severity: 'warning',
      message: 'Rotated atlas frames are not a tested NineSlice input; disable rotation for this sprite.',
    });
  }
  if (x < 0 || y < 0 || x + w > image.width || y + h > image.height) {
    findings.push({
      code: 'atlas.frame-outside-image',
      severity: 'error',
      message: `Frame ${w}x${h}+${x}+${y} lies outside the ${image.width}x${image.height} image.`,
    });
    return { name, ok: false, findings };
  }
  const borders = frame.scale9Borders;
  if (borders === undefined) {
    findings.push({
      code: 'atlas.no-borders',
      severity: 'error',
      message: 'The frame has no scale9Borders.',
    });
    return { name, ok: false, findings };
  }
  if (borders.x < 0 || borders.y < 0 || borders.w <= 0 || borders.h <= 0 || borders.x + borders.w > w || borders.y + borders.h > h) {
    findings.push({
      code: 'atlas.borders-outside-frame',
      severity: 'error',
      message: `scale9Borders ${JSON.stringify(borders)} must lie inside the ${w}x${h} frame with a positive size.`,
    });
    return { name, ok: false, findings };
  }

  const inspection = inspectRaster(cropRaster(image, { x, y, width: w, height: h }), {
    ...options,
    insets: scale9BordersToInsets(borders, w, h),
    mode: borders.y === 0 && borders.h === h ? 'three' : 'nine',
  });
  return {
    name,
    ok: inspection.ok && !findings.some((finding) => finding.severity === 'error'),
    findings,
    inspection,
  };
}
