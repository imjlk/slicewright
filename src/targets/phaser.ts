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
  exportLayout: exportPhaser,
};

/**
 * Phaser reads borders that span the full frame height as its horizontal
 * three-slice and keeps the height, so a layout whose height stretches as one
 * full-height span has no Phaser encoding.
 *
 * @evidence docs/spec.md#phaser-scale9borders Rejects a full-height vertical stretch span, which Phaser would read as its three-slice.
 * @evidenceReview docs/spec.md#phaser-scale9borders #4c250ad Checked this code against the section line by line and ran convertsToPhaserBorders green with pnpm test.
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
 * @evidenceReview docs/spec.md#phaser-scale9borders #4c250ad Checked this code against the section line by line and ran convertsToPhaserBorders green with pnpm test.
 */
export function exportPhaser({
  name,
  imageRef,
  raster,
  layout,
  loaderPaths,
}: ExportInput): Omit<ExportResult, 'target' | 'findings'> {
  const atlas = createSingleFrameAtlas(
    name,
    imageRef,
    raster.width,
    raster.height,
    exportInsets(layout),
    layoutShape(layout) === 'three-vertical' ? 'three-vertical' : undefined,
  );
  const tileX = axisTiles(layout.x);
  const tileY = axisTiles(layout.y);
  const tileArgs =
    tileX || tileY ? `, undefined, undefined, undefined, undefined, ${tileX}, ${tileY}` : '';
  return {
    files: [{ path: `${name}.json`, contents: `${JSON.stringify(atlas, null, 2)}\n` }],
    usage:
      // Phaser resolves both URLs against its loader path, not the atlas file.
      // Values are serialized as string literals so quotes in names stay valid code.
      `this.load.atlas(${js(name)}, ${js(urlFromPath(loaderPaths?.image ?? imageRef))}, ${js(urlFromPath(joinUrl(loaderPaths?.directory ?? '', `${name}.json`)))});\n` +
      `this.add.nineslice(x, y, ${js(name)}, ${js(name)}, width, height${tileArgs});` +
      // Prose goes in a comment so the snippet stays valid JavaScript.
      (fixedAxisNote(layout) === '' ? '' : `\n//${fixedAxisNote(layout)}`),
  };
}

function joinUrl(directory: string, file: string): string {
  return directory === '' || directory === '.' ? file : `${directory.replace(/\/+$/, '')}/${file}`;
}

function js(value: string): string {
  return JSON.stringify(value);
}
