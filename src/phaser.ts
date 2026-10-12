import typia from 'typia';

import { inspectRaster, type Finding, type InspectOptions, type InspectReport } from './inspect.js';
import { contentLimits, layoutFromInsets, type SliceLayout } from './layout.js';
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
    /**
     * Axes that repeat instead of stretching. Phaser takes tiling only as
     * NineSlice constructor arguments, so this records what to pass.
     */
    readonly tile?: { readonly x: boolean; readonly y: boolean };
  };
}

/** slicewright's frame data, as `createSingleFrameAtlas` and packing write it. */
export type SlicewrightFrameData = NonNullable<PhaserAtlasFrame['slicewright']>;

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
 * @evidenceReview docs/spec.md#phaser-scale9borders #4aec64c Checked this code against the section line by line and ran convertsToPhaserBorders green with pnpm test.
 */
export function createSingleFrameAtlas(
  name: string,
  image: string,
  width: number,
  height: number,
  insets: SliceInsets,
  extra: SlicewrightFrameData = {},
): PhaserJsonHashAtlas {
  const rect = { x: 0, y: 0, w: width, h: height };
  const data = {
    ...(extra.shape === undefined ? {} : { shape: extra.shape }),
    ...(extra.contentPadding === undefined ? {} : { contentPadding: extra.contentPadding }),
    ...(extra.tile === undefined || (!extra.tile.x && !extra.tile.y) ? {} : { tile: extra.tile }),
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
 * @evidenceReview docs/spec.md#atlas-frames #0dc6d1b Checked this code against the section line by line and ran checksAtlasFrames green with pnpm test.
 */
export function inspectAtlas(
  json: unknown,
  image: Raster,
  options: InspectOptions,
  frameName?: string,
): AtlasReport {
  const { atlas, format, entries } = readAtlas(json);
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

/** Validates a Phaser JSON Hash or JSON Array atlas and lists its frames by name. */
export function readAtlas(json: unknown): {
  readonly atlas: PhaserAtlas;
  readonly format: 'hash' | 'array';
  readonly entries: ReadonlyArray<readonly [string, PhaserAtlasFrame]>;
} {
  const atlas = typia.assert<PhaserAtlas>(json);
  return Array.isArray(atlas.frames)
    ? {
        atlas,
        format: 'array',
        entries: (atlas as PhaserJsonArrayAtlas).frames.map((frame) => [frame.filename, frame]),
      }
    : { atlas, format: 'hash', entries: Object.entries((atlas as PhaserJsonHashAtlas).frames) };
}

/**
 * The slice shape a frame's borders and marker describe: borders spanning the
 * full height are Phaser's three-slice; a fixed width needs the explicit
 * marker, because full-width borders alone are an ordinary nine-slice.
 */
export function frameShape(frame: PhaserAtlasFrame): 'nine' | 'three' | 'three-vertical' {
  const borders = frame.scale9Borders;
  if (borders !== undefined && borders.y === 0 && borders.h === frame.frame.h) {
    return 'three';
  }
  return frame.slicewright?.shape === 'three-vertical' ? 'three-vertical' : 'nine';
}

/**
 * The layout a frame records: its borders as insets, its shape, and the
 * tiling and content padding in its slicewright data. Undefined when the
 * frame has no `scale9Borders`; call it only on borders that fit the frame.
 */
export function frameLayout(frame: PhaserAtlasFrame): SliceLayout | undefined {
  const borders = frame.scale9Borders;
  if (borders === undefined) {
    return undefined;
  }
  const { w, h } = frame.frame;
  const data = frame.slicewright;
  return layoutFromInsets(scale9BordersToInsets(borders, w, h), w, h, {
    shape: frameShape(frame),
    tile: { x: data?.tile?.x === true, y: data?.tile?.y === true },
    ...(data?.contentPadding === undefined ? {} : { content: data.contentPadding }),
  });
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
  // A fractional rectangle would crop at shifted byte offsets.
  const fractional = ![x, y, w, h].every(Number.isInteger);
  if (fractional || x < 0 || y < 0 || x + w > image.width || y + h > image.height) {
    findings.push({
      code: 'atlas.frame-outside-image',
      severity: 'error',
      message: fractional
        ? `Frame ${w}x${h}+${x}+${y} is not a whole-pixel rectangle.`
        : `Frame ${w}x${h}+${x}+${y} lies outside the ${image.width}x${image.height} image.`,
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
  // Padding must also stay within the fixed segments that scale9Borders leaves.
  const fixedEdges = contentLimits(
    layoutFromInsets(scale9BordersToInsets(borders, w, h), w, h, { shape: frameShape(frame) }),
  );
  const paddingIssue =
    padding === undefined
      ? undefined
      : (paddingProblem(padding, w, h) ??
        (['left', 'right', 'top', 'bottom'] as const)
          .filter((side) => padding[side] > fixedEdges[side])
          .map(
            (side) =>
              `${side} content padding ${padding[side]} reaches past the fixed ${fixedEdges[side]} px that scale9Borders leaves at that edge.`,
          )[0]);
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
    // Recorded tiling is checked for seams like tiling asked for on the command line.
    tile: {
      x: options.tile.x || frame.slicewright?.tile?.x === true,
      y: options.tile.y || frame.slicewright?.tile?.y === true,
    },
    mode: frameShape(frame),
  });
  return {
    name,
    ok: inspection.ok && !findings.some((finding) => finding.severity === 'error'),
    findings,
    inspection,
  };
}
