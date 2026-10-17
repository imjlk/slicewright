import type { Finding } from '../inspect.js';
import { axisTiles, flexibleSegments, layoutShape, type SliceLayout } from '../layout.js';
import { createSingleFrameAtlas } from '../phaser.js';
import { exportInsets, fixedAxisNote, urlFromPath } from './common.js';
import type { ExportInput, ExportResult, SliceTarget } from './types.js';

export const phaserTarget: SliceTarget = {
  id: 'phaser',
  label: 'Phaser 4',
  status: 'verified',
  capabilities: {
    shapes: ['nine', 'three'],
    emulated: ['three-vertical'],
    tile: 'per-axis',
    tileCount: 'floor',
  },
  check: checkPhaserLayout,
  outputs: (name) => [`${name}.json`],
  exportLayout: exportPhaser,
};

/**
 * Phaser reads borders that span the full frame height as its horizontal
 * three-slice and keeps the height, so a layout whose height stretches as one
 * full-height span has no Phaser encoding.
 *
 * @evidence docs/spec.md#phaser-scale9borders Rejects a full-height vertical stretch span, which Phaser would read as its three-slice.
 * @evidenceReview docs/spec.md#phaser-scale9borders #4aec64c Checked this code against the section line by line and ran convertsToPhaserBorders green with pnpm test.
 */
export function checkPhaserLayout(layout: SliceLayout): Finding[] {
  const vertical = flexibleSegments(layout.y);
  const fullHeight =
    vertical.length === 1 && vertical[0]?.start === 0 && vertical[0].end === layout.y.length;
  return fullHeight
    ? [
        {
          code: 'target.unsupported',
          severity: 'error',
          message:
            'Phaser reads borders spanning the full height as its horizontal three-slice and keeps the height, so a full-height vertical stretch cannot be exported. Give the art top and bottom insets, or use CSS.',
        },
      ]
    : [];
}

/**
 * Phaser 4 NineSlice: a one-frame JSON Hash atlas whose `scale9Borders`
 * NineSlice reads, plus the `tileX` / `tileY` constructor flags for tiled axes.
 *
 * @evidence docs/spec.md#phaser-scale9borders Exports the atlas frame and the nineslice call with tiling flags for the Phaser target.
 * @evidenceReview docs/spec.md#phaser-scale9borders #4aec64c Checked this code against the section line by line and ran convertsToPhaserBorders green with pnpm test.
 */
export function exportPhaser({
  name,
  imageRef,
  raster,
  layout,
  loaderPaths,
}: ExportInput): Omit<ExportResult, 'target' | 'findings'> {
  const tileX = axisTiles(layout.x);
  const tileY = axisTiles(layout.y);
  const atlas = createSingleFrameAtlas(
    name,
    imageRef,
    raster.width,
    raster.height,
    exportInsets(layout),
    {
      ...(layoutShape(layout) === 'three-vertical' ? { shape: 'three-vertical' as const } : {}),
      ...(layout.content === undefined ? {} : { contentPadding: layout.content }),
      tile: { x: tileX, y: tileY },
    },
  );
  return {
    files: [{ path: `${name}.json`, contents: `${JSON.stringify(atlas, null, 2)}\n` }],
    usage: phaserUsage(
      name,
      loaderPaths?.image ?? imageRef,
      joinUrl(loaderPaths?.directory ?? '', `${name}.json`),
      [
        {
          name,
          tile: { x: tileX, y: tileY },
          note: fixedAxisNote(layout),
          contentPadding: layout.content !== undefined,
        },
      ],
    ),
  };
}

export interface PhaserUsageFrame {
  readonly name: string;
  /** A frame without borders, drawn as a plain image. */
  readonly plain?: boolean;
  readonly tile: { readonly x: boolean; readonly y: boolean };
  /** A note such as keeping a fixed axis at its size, or an empty string. */
  readonly note: string;
  readonly contentPadding: boolean;
}

/**
 * The `this.load.atlas` call for an atlas and a `nineslice` call per frame,
 * with tiling flags, notes, and where to read content padding in comments.
 * Paths are relative to Phaser's loader path and become percent-encoded URLs.
 */
export function phaserUsage(
  key: string,
  imagePath: string,
  atlasPath: string,
  frames: readonly PhaserUsageFrame[],
): string {
  // Phaser resolves both URLs against its loader path, not the atlas file.
  // Values are serialized as string literals so quotes in names stay valid code.
  const lines = [
    `this.load.atlas(${js(key)}, ${js(urlFromPath(imagePath))}, ${js(urlFromPath(atlasPath))});`,
  ];
  for (const frame of frames) {
    if (frame.plain === true) {
      lines.push(`this.add.image(x, y, ${js(key)}, ${js(frame.name)});`);
      continue;
    }
    const tileArgs =
      frame.tile.x || frame.tile.y
        ? `, undefined, undefined, undefined, undefined, ${frame.tile.x}, ${frame.tile.y}`
        : '';
    lines.push(
      `this.add.nineslice(x, y, ${js(key)}, ${js(frame.name)}, width, height${tileArgs});`,
    );
    // Prose goes in a comment so the snippet stays valid JavaScript.
    if (frame.note !== '') {
      lines.push(`//${frame.note}`);
    }
    if (frame.contentPadding) {
      lines.push(
        `// Content padding (left, right, top, bottom): this.textures.getFrame(${js(key)}, ${js(frame.name)}).customData.slicewright.contentPadding`,
      );
    }
  }
  return lines.join('\n');
}

/** Joins a directory and a file name with `/`, as loader paths use. */
export function joinUrl(directory: string, file: string): string {
  return directory === '' || directory === '.' ? file : `${directory.replace(/\/+$/, '')}/${file}`;
}

function js(value: string): string {
  return JSON.stringify(value);
}
