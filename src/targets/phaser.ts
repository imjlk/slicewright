import { axisTiles } from '../layout.js';
import { createSingleFrameAtlas } from '../phaser.js';
import { exportInsets, fixedAxisNote } from './common.js';
import type { ExportInput, ExportResult, SliceTarget } from './types.js';

export const phaserTarget: SliceTarget = {
  id: 'phaser',
  label: 'Phaser 4',
  capabilities: { shapes: ['nine', 'three'], emulated: ['three-vertical'], tile: 'per-axis' },
  exportLayout: exportPhaser,
};

/**
 * Phaser 4 NineSlice: a one-frame JSON Hash atlas whose `scale9Borders`
 * NineSlice reads, plus the `tileX` / `tileY` constructor flags for tiled axes.
 *
 * @evidence docs/spec.md#phaser-scale9borders Exports the atlas frame and the nineslice call with tiling flags for the Phaser target.
 * @evidenceReview docs/spec.md#phaser-scale9borders #bb888dc Checked this code against the section line by line and ran convertsToPhaserBorders green with pnpm test.
 */
export function exportPhaser({ name, imageRef, raster, layout }: ExportInput): Omit<ExportResult, 'target' | 'findings'> {
  const atlas = createSingleFrameAtlas(
    name,
    imageRef,
    raster.width,
    raster.height,
    exportInsets(layout),
  );
  const tileX = axisTiles(layout.x);
  const tileY = axisTiles(layout.y);
  const tileArgs =
    tileX || tileY ? `, undefined, undefined, undefined, undefined, ${tileX}, ${tileY}` : '';
  return {
    files: [{ path: `${name}.json`, contents: `${JSON.stringify(atlas, null, 2)}\n` }],
    usage:
      `this.load.atlas('${name}', '${imageRef}', '${name}.json');\n` +
      `this.add.nineslice(x, y, '${name}', '${name}', width, height${tileArgs});` +
      fixedAxisNote(layout),
  };
}
