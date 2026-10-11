import typia from 'typia';

import { inspectRaster, type Finding, type InspectOptions, type InspectReport } from './inspect.js';
import { paddingProblem } from './padding.js';
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
  /**
   * slicewright's own frame data, which Phaser keeps in `frame.customData`.
   * `shape: 'three-vertical'` marks zero side insets as a fixed width rather
   * than a full-width stretch span, which `scale9Borders` alone cannot say.
   */
  readonly slicewright?: {
    readonly shape?: 'three-vertical';
    /** Where content sits inside the frame, in frame pixels from each edge. */
    readonly contentPadding?: SliceInsets;
  };
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
 * @evidenceReview docs/spec.md#phaser-scale9borders #4c250ad Checked this code against the section line by line and ran convertsToPhaserBorders green with pnpm test.
 */
export function createSingleFrameAtlas(
  name: string,
  image: string,
  width: number,
  height: number,
  insets: SliceInsets,
  extra: { readonly shape?: 'three-vertical'; readonly contentPadding?: SliceInsets } = {},
): PhaserJsonHashAtlas {
  const rect = { x: 0, y: 0, w: width, h: height };
  const data = {
    ...(extra.shape === undefined ? {} : { shape: extra.shape }),
    ...(extra.contentPadding === undefined ? {} : { contentPadding: extra.contentPadding }),
  };
  return {
    frames: {
      [name]: {
        frame: rect,
        rotated: false,
        trimmed: false,
        spriteSourceSize: rect,
        sourceSize: { w: width, h: height },
        scale9Borders: insetsToScale9Borders(insets, width, height),
        ...(Object.keys(data).length === 0 ? {} : { slicewright: data }),
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
 * @evidenceReview docs/spec.md#atlas-frames #62a16b1 Checked this code against the section line by line and ran checksAtlasFrames green with pnpm test.
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

  const padding = frame.slicewright?.contentPadding;
  const paddingIssue = padding === undefined ? undefined : paddingProblem(padding, w, h);
  if (paddingIssue !== undefined) {
    findings.push({ code: 'atlas.padding-invalid', severity: 'error', message: paddingIssue });
    return { name, ok: false, findings };
  }
  if (frame.slicewright?.shape === 'three-vertical' && !(borders.x === 0 && borders.w === w)) {
    findings.push({
      code: 'atlas.marker-mismatch',
      severity: 'error',
      message:
        'The frame is marked as a vertical three-slice but its scale9Borders do not span the full width, so Phaser renders it as a nine-slice.',
    });
    return { name, ok: false, findings };
  }
  const inspection = inspectRaster(cropRaster(image, { x, y, width: w, height: h }), {
    ...options,
    insets: scale9BordersToInsets(borders, w, h),
    // Phaser's own three-slice keeps the height. A fixed width needs the
    // explicit marker: full-width borders alone are an ordinary nine-slice.
    mode:
      borders.y === 0 && borders.h === h
        ? 'three'
        : frame.slicewright?.shape === 'three-vertical'
          ? 'three-vertical'
          : 'nine',
  });
  return {
    name,
    ok: inspection.ok && !findings.some((finding) => finding.severity === 'error'),
    findings,
    inspection,
  };
}
