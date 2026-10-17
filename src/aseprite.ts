import typia, { type tags } from 'typia';

import { inspectRaster, type Finding, type InspectOptions, type InspectReport } from './inspect.js';
import type { PhaserAtlasMeta } from './phaser.js';
import { cropRaster, type Raster } from './raster.js';
import type { SliceInsets } from './slices.js';

export interface AsepriteRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** One key of an Aseprite slice; it holds from its frame until the next key. */
export interface AsepriteSliceKey {
  readonly frame: number;
  /** The slice rectangle on the sprite canvas. */
  readonly bounds: AsepriteRect;
  /** The nine-slice center, relative to `bounds`. */
  readonly center?: AsepriteRect;
  /** The pivot, relative to `bounds`. */
  readonly pivot?: { readonly x: number; readonly y: number };
}

export interface AsepriteSlice {
  readonly name: string;
  readonly color?: string;
  readonly data?: string;
  readonly keys: readonly AsepriteSliceKey[] & tags.MinItems<1>;
}

export interface AsepriteFrame {
  readonly frame: AsepriteRect;
  readonly rotated?: boolean;
  readonly trimmed?: boolean;
  readonly spriteSourceSize?: AsepriteRect;
  readonly sourceSize?: { readonly w: number; readonly h: number };
  readonly duration?: number;
}

export interface AsepriteMeta extends PhaserAtlasMeta {
  readonly app?: string;
  readonly slices?: readonly AsepriteSlice[];
}

/** Aseprite's `--sheet --data` JSON, as a hash or an array of frames. */
export interface AsepriteSheet {
  readonly frames:
    | Readonly<Record<string, AsepriteFrame>>
    | ReadonlyArray<AsepriteFrame & { readonly filename: string }>;
  readonly meta: AsepriteMeta;
}

export interface AsepriteSliceFrameReport {
  /** Frame index in the sheet. */
  readonly frame: number;
  readonly frameName?: string;
  /** The frame of the key that applies here. */
  readonly key: number;
  readonly bounds: AsepriteRect;
  readonly center?: AsepriteRect;
  readonly pivot?: { readonly x: number; readonly y: number };
  /** The center as insets from the edges of `bounds`. */
  readonly insets?: SliceInsets;
  readonly ok: boolean;
  readonly findings: readonly Finding[];
  readonly inspection?: InspectReport;
}

export interface AsepriteSliceReport {
  readonly name: string;
  readonly ok: boolean;
  readonly frames: readonly AsepriteSliceFrameReport[];
  readonly findings: readonly Finding[];
}

export interface AsepriteReport {
  readonly ok: boolean;
  readonly format: 'aseprite';
  readonly frameLayout: 'hash' | 'array';
  readonly slices: readonly AsepriteSliceReport[];
  readonly findings: readonly Finding[];
}

/**
 * Whether parsed JSON is an Aseprite sheet: its `meta.app` names Aseprite or
 * its `meta.slices` is a list. Phaser and TexturePacker atlases have neither.
 */
export function isAsepriteSheet(json: unknown): boolean {
  if (typeof json !== 'object' || json === null || !('meta' in json)) {
    return false;
  }
  const meta: unknown = json.meta;
  if (typeof meta !== 'object' || meta === null) {
    return false;
  }
  const app = 'app' in meta ? meta.app : undefined;
  return (
    (typeof app === 'string' && app.toLowerCase().includes('aseprite')) ||
    ('slices' in meta && Array.isArray(meta.slices))
  );
}

/**
 * Validates an Aseprite sheet, then checks every slice with a nine-slice
 * center, or only `sliceName`, against the pixels of each frame its keys cover.
 *
 * @evidence docs/spec.md#aseprite-slices Maps each key's bounds into the sheet, turns its center into insets, and inspects every covered frame with them.
 * @evidenceReview docs/spec.md#aseprite-slices #8c1cbc8 Checked this code against the section line by line and ran checksAsepriteSlices green with pnpm test.
 */
export function inspectAsepriteSlices(
  json: unknown,
  image: Raster,
  options: InspectOptions,
  sliceName?: string,
): AsepriteReport {
  const sheet = typia.assert<AsepriteSheet>(json);
  const frameLayout = Array.isArray(sheet.frames) ? 'array' : 'hash';
  const frames: ReadonlyArray<readonly [string, AsepriteFrame]> = Array.isArray(sheet.frames)
    ? (sheet.frames as ReadonlyArray<AsepriteFrame & { readonly filename: string }>).map(
        (frame) => [frame.filename, frame] as const,
      )
    : Object.entries(sheet.frames as Readonly<Record<string, AsepriteFrame>>);
  const findings: Finding[] = [];

  const size = sheet.meta.size;
  if (size !== undefined && (size.w !== image.width || size.h !== image.height)) {
    findings.push({
      code: 'atlas.size-mismatch',
      severity: 'warning',
      message: `meta.size is ${size.w}x${size.h} but the image is ${image.width}x${image.height}.`,
    });
  }

  const all = sheet.meta.slices ?? [];
  const selected = all.filter((slice) =>
    sliceName === undefined
      ? slice.keys.some((key) => key.center !== undefined)
      : slice.name === sliceName,
  );
  if (sliceName !== undefined && selected.length === 0) {
    findings.push({
      code: 'aseprite.slice-missing',
      severity: 'error',
      message: `Slice "${sliceName}" is not in meta.slices.`,
    });
  }
  if (sliceName === undefined && selected.length === 0) {
    findings.push({
      code: 'aseprite.no-slices',
      severity: 'info',
      message:
        all.length === 0
          ? 'meta.slices is empty; export with --list-slices (or "Slices" in the export dialog).'
          : 'No slice has a nine-slice center.',
    });
  }

  const slices = selected.map((slice) => inspectSlice(slice, frames, image, options));
  return {
    ok:
      !findings.some((finding) => finding.severity === 'error') &&
      slices.every((slice) => slice.ok),
    format: 'aseprite',
    frameLayout,
    slices,
    findings,
  };
}

function inspectSlice(
  slice: AsepriteSlice,
  frames: ReadonlyArray<readonly [string, AsepriteFrame]>,
  image: Raster,
  options: InspectOptions,
): AsepriteSliceReport {
  const findings: Finding[] = [];
  const keys = [...slice.keys].sort((a, b) => a.frame - b.frame);
  const reports: AsepriteSliceFrameReport[] = [];
  keys.forEach((key, index) => {
    // The next key may itself be out of range; never loop past the last frame.
    const end = Math.min(keys[index + 1]?.frame ?? frames.length, frames.length);
    if (!Number.isInteger(key.frame) || key.frame < 0 || key.frame >= frames.length) {
      findings.push({
        code: 'aseprite.frame-missing',
        severity: 'error',
        message: `A key of slice "${slice.name}" starts at frame ${key.frame}, but the sheet has ${frames.length} frames.`,
      });
      return;
    }
    // Aseprite writes a zero-size key where the slice is hidden from that frame on.
    if (key.bounds.w === 0 || key.bounds.h === 0) {
      return;
    }
    for (let frame = key.frame; frame < end; frame += 1) {
      const entry = frames[frame];
      if (entry !== undefined) {
        reports.push(inspectKey(key, frame, entry[0], entry[1], image, options));
      }
    }
  });
  if (keys.length > 0 && keys.every((key) => key.center === undefined)) {
    findings.push({
      code: 'aseprite.no-center',
      severity: 'info',
      message: `Slice "${slice.name}" has no nine-slice center; only its bounds are checked.`,
    });
  }
  return {
    name: slice.name,
    ok:
      !findings.some((finding) => finding.severity === 'error') &&
      reports.every((report) => report.ok),
    frames: reports,
    findings,
  };
}

/** A whole pixel coordinate small enough that sums of two stay exact. */
function isPixel(value: number): boolean {
  return Number.isInteger(value) && Math.abs(value) <= 0x7fffffff;
}

function inspectKey(
  key: AsepriteSliceKey,
  frame: number,
  frameName: string,
  sheetFrame: AsepriteFrame,
  image: Raster,
  options: InspectOptions,
): AsepriteSliceFrameReport {
  const { bounds, center, pivot } = key;
  const base = {
    frame,
    frameName,
    key: key.frame,
    bounds,
    ...(center === undefined ? {} : { center }),
    ...(pivot === undefined ? {} : { pivot }),
  };
  const fail = (code: string, message: string): AsepriteSliceFrameReport => ({
    ...base,
    ok: false,
    findings: [{ code, severity: 'error', message }],
  });

  if (sheetFrame.rotated === true) {
    return fail(
      'aseprite.rotated',
      'Rotated sheet frames cannot be mapped to slice bounds; export without rotation.',
    );
  }
  if (![bounds.x, bounds.y, bounds.w, bounds.h].every(isPixel) || bounds.w <= 0 || bounds.h <= 0) {
    return fail(
      'aseprite.bounds-invalid',
      `Slice bounds ${JSON.stringify(bounds)} are not a whole-pixel rectangle with a positive size.`,
    );
  }
  // Bounds are on the sprite canvas; a trimmed frame keeps only spriteSourceSize of it.
  const { x, y, w, h } = sheetFrame.frame;
  if (sheetFrame.trimmed === true && sheetFrame.spriteSourceSize === undefined) {
    return fail(
      'aseprite.bounds-outside-frame',
      'A trimmed frame without spriteSourceSize cannot place slice bounds; export without trimming.',
    );
  }
  const kept = sheetFrame.spriteSourceSize ?? { x: 0, y: 0, w, h };
  // A fractional rectangle would crop at shifted byte offsets.
  for (const [label, rect] of [
    ['Frame', sheetFrame.frame],
    ['spriteSourceSize', kept],
  ] as const) {
    if (![rect.x, rect.y, rect.w, rect.h].every(isPixel) || rect.w <= 0 || rect.h <= 0) {
      return fail(
        'atlas.frame-outside-image',
        `${label} ${rect.w}x${rect.h}+${rect.x}+${rect.y} is not a whole-pixel rectangle with a positive size.`,
      );
    }
  }
  if (
    bounds.x < kept.x ||
    bounds.y < kept.y ||
    bounds.x + bounds.w > kept.x + kept.w ||
    bounds.y + bounds.h > kept.y + kept.h
  ) {
    return fail(
      'aseprite.bounds-outside-frame',
      sheetFrame.trimmed === true
        ? `Slice bounds ${JSON.stringify(bounds)} reach past the trimmed frame ${JSON.stringify(kept)}; export without trimming.`
        : `Slice bounds ${JSON.stringify(bounds)} reach past the ${kept.w}x${kept.h} frame.`,
    );
  }
  if (x < 0 || y < 0 || x + w > image.width || y + h > image.height) {
    return fail(
      'atlas.frame-outside-image',
      `Frame ${w}x${h}+${x}+${y} lies outside the ${image.width}x${image.height} image.`,
    );
  }
  // The kept pixels lie on the sprite canvas.
  const source = sheetFrame.sourceSize;
  if (
    kept.x < 0 ||
    kept.y < 0 ||
    (source !== undefined && (kept.x + kept.w > source.w || kept.y + kept.h > source.h))
  ) {
    return fail(
      'aseprite.bounds-outside-frame',
      `spriteSourceSize ${kept.w}x${kept.h}+${kept.x}+${kept.y} reaches past the sprite canvas.`,
    );
  }
  // --inner-padding grows the frame by the same border on each side of the kept pixels.
  const padX = (w - kept.w) / 2;
  const padY = (h - kept.h) / 2;
  if (!Number.isInteger(padX) || !Number.isInteger(padY) || padX < 0 || padY < 0) {
    return fail(
      'aseprite.bounds-outside-frame',
      `The ${w}x${h} frame cannot hold its ${kept.w}x${kept.h} spriteSourceSize with an even inner padding.`,
    );
  }
  const rect = {
    x: x + padX + bounds.x - kept.x,
    y: y + padY + bounds.y - kept.y,
    width: bounds.w,
    height: bounds.h,
  };
  if (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.width > image.width ||
    rect.y + rect.height > image.height
  ) {
    return fail(
      'atlas.frame-outside-image',
      `Slice bounds map to ${rect.width}x${rect.height}+${rect.x}+${rect.y}, outside the ${image.width}x${image.height} image.`,
    );
  }
  if (center === undefined) {
    return { ...base, ok: true, findings: [] };
  }
  if (
    ![center.x, center.y, center.w, center.h].every(isPixel) ||
    center.x < 0 ||
    center.y < 0 ||
    center.w <= 0 ||
    center.h <= 0 ||
    center.x + center.w > bounds.w ||
    center.y + center.h > bounds.h
  ) {
    return fail(
      'aseprite.center-invalid',
      `Center ${JSON.stringify(center)} must lie inside the ${bounds.w}x${bounds.h} slice bounds with a positive size.`,
    );
  }
  const insets = {
    left: center.x,
    right: bounds.w - center.x - center.w,
    top: center.y,
    bottom: bounds.h - center.y - center.h,
  };
  const inspection = inspectRaster(cropRaster(image, rect), {
    ...options,
    insets,
    // A center spanning the full height leaves a fixed height, as in Phaser;
    // one spanning the full width leaves a fixed width.
    mode:
      insets.top === 0 && insets.bottom === 0
        ? 'three'
        : insets.left === 0 && insets.right === 0
          ? 'three-vertical'
          : 'nine',
  });
  return { ...base, insets, ok: inspection.ok, findings: [], inspection };
}
