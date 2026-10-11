import { axisTiles, type AxisLayout } from '../layout.js';
import { exportInsets, fixedAxisNote } from './common.js';
import type { ExportInput, ExportResult, SliceTarget } from './types.js';

export const godotTarget: SliceTarget = {
  id: 'godot',
  label: 'Godot 4',
  capabilities: { shapes: ['nine'], emulated: ['three', 'three-vertical'], tile: 'per-axis' },
  exportLayout: exportGodot,
};

/** Godot 4 `StyleBoxTexture.AxisStretchMode`: STRETCH = 0, TILE_FIT = 2. */
const stretchMode = (axis: AxisLayout): number => (axisTiles(axis) ? 2 : 0);

/**
 * Godot 4 `StyleBoxTexture` resource: texture margins from the insets and
 * `TILE_FIT` for tiled axes. The image path is a `res://` path.
 *
 * @evidence docs/spec.md#godot-styleboxtexture Writes the StyleBoxTexture resource with margins and axis stretch modes for the Godot target.
 * @evidenceReview docs/spec.md#godot-styleboxtexture #c03c96a Checked this code against the section line by line and ran exportsGodotStyleBox green with pnpm test.
 */
export function exportGodot({ name, imageRef, layout }: ExportInput): Omit<ExportResult, 'target' | 'findings'> {
  const { left, top, right, bottom } = exportInsets(layout);
  const path = godotPath(imageRef);
  const resource = [
    '[gd_resource type="StyleBoxTexture" load_steps=2 format=3]',
    '',
    `[ext_resource type="Texture2D" path="${path}" id="1_texture"]`,
    '',
    '[resource]',
    'texture = ExtResource("1_texture")',
    `texture_margin_left = ${left.toFixed(1)}`,
    `texture_margin_top = ${top.toFixed(1)}`,
    `texture_margin_right = ${right.toFixed(1)}`,
    `texture_margin_bottom = ${bottom.toFixed(1)}`,
    `axis_stretch_horizontal = ${stretchMode(layout.x)}`,
    `axis_stretch_vertical = ${stretchMode(layout.y)}`,
    '',
  ].join('\n');
  return {
    files: [{ path: `${name}.tres`, contents: resource }],
    usage:
      `Assign ${name}.tres as a theme StyleBox (for example a Panel's "panel" override). ` +
      `The texture path is ${path}; move the image there or edit the path.` +
      fixedAxisNote(layout),
  };
}

/**
 * A `res://` path for the image: kept when it already is one, relative inside
 * the output directory, or the bare file name when it lies outside it.
 *
 * @evidence docs/spec.md#godot-styleboxtexture Keeps res paths, keeps paths inside the output directory, and falls back to the file name outside it.
 * @evidenceReview docs/spec.md#godot-styleboxtexture #c03c96a Checked this code against the section line by line and ran exportsGodotStyleBox green with pnpm test.
 */
export function godotPath(imageRef: string): string {
  if (imageRef.startsWith('res://')) {
    return imageRef;
  }
  const relativePath = imageRef.replace(/^\.\//, '');
  const outside = relativePath.startsWith('../') || relativePath.startsWith('/');
  return `res://${outside ? (relativePath.split('/').at(-1) ?? relativePath) : relativePath}`;
}
