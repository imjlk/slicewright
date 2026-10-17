import type { Finding } from '../inspect.js';
import { axisTiles, type AxisLayout, type SliceLayout } from '../layout.js';
import { exportInsets, fixedAxisNote } from './common.js';
import type { ExportInput, ExportResult, SliceTarget } from './types.js';
import { oneLine } from './unity.js';

export const godotTarget: SliceTarget = {
  id: 'godot',
  label: 'Godot 4',
  status: 'experimental',
  capabilities: {
    shapes: ['nine'],
    emulated: ['three', 'three-vertical'],
    tile: 'per-axis',
    tileCount: 'floor',
  },
  check: checkGodotLayout,
  exportLayout: exportGodot,
};

/** Godot's `AxisStretchMode`: 0 stretches, 2 tiles whole tiles scaled to fit. */
const stretchMode = (axis: AxisLayout): number => (axisTiles(axis) ? 2 : 0);

/**
 * Godot's tile-fit mode scales tiles so whole ones fit, which may pick another
 * count than the layout's rounding down.
 *
 * @evidence docs/spec.md#experimental-targets Warns that Godot's tile fit may pick another tile count.
 * @evidenceReview docs/spec.md#experimental-targets #0f54f66 Checked this code against the section line by line and ran exportsExperimentalTargets green with pnpm test.
 */
export function checkGodotLayout(layout: SliceLayout): Finding[] {
  return axisTiles(layout.x) || axisTiles(layout.y)
    ? [
        {
          code: 'target.tile',
          severity: 'warning',
          message:
            "Godot's tile fit scales the tiles so whole ones fit, which may show another tile count than the layout's rounding down.",
        },
      ]
    : [];
}

/**
 * Godot 4: a `StyleBoxTexture` resource with texture margins, content margins
 * from the content padding, and an axis stretch mode per axis, plus the same
 * values as `NinePatchRect` properties. The texture path is `res://` plus the
 * image reference unless it already starts with `res://`.
 *
 * @evidence docs/spec.md#experimental-targets Writes the StyleBoxTexture .tres with margins and stretch modes and prints NinePatchRect properties.
 * @evidenceReview docs/spec.md#experimental-targets #0f54f66 Checked this code against the section line by line and ran exportsExperimentalTargets green with pnpm test.
 */
export function exportGodot({
  name,
  imageRef,
  layout,
}: ExportInput): Omit<ExportResult, 'target' | 'findings'> {
  const { left, right, top, bottom } = exportInsets(layout);
  const padding = layout.content;
  const horizontal = stretchMode(layout.x);
  const vertical = stretchMode(layout.y);
  const path = imageRef.startsWith('res://') ? imageRef : `res://${imageRef}`;
  const tres = [
    '[gd_resource type="StyleBoxTexture" load_steps=2 format=3]',
    '',
    `[ext_resource type="Texture2D" path="${godotString(path)}" id="1_texture"]`,
    '',
    '[resource]',
    'texture = ExtResource("1_texture")',
    `texture_margin_left = ${left}.0`,
    `texture_margin_top = ${top}.0`,
    `texture_margin_right = ${right}.0`,
    `texture_margin_bottom = ${bottom}.0`,
    ...(padding === undefined
      ? []
      : [
          `content_margin_left = ${padding.left}.0`,
          `content_margin_top = ${padding.top}.0`,
          `content_margin_right = ${padding.right}.0`,
          `content_margin_bottom = ${padding.bottom}.0`,
        ]),
    `axis_stretch_horizontal = ${horizontal}`,
    `axis_stretch_vertical = ${vertical}`,
    '',
  ].join('\n');
  const note = fixedAxisNote(layout).trim();
  const usage = [
    `# slicewright: ${oneLine(name)}, experimental. ${name}.tres loads the texture from ${oneLine(path)}; pass --image-ref res://… when that is not its project path.`,
    '# A Control theme or add_theme_stylebox_override takes the StyleBoxTexture; a NinePatchRect takes:',
    `texture = load("${godotString(path)}")`,
    `patch_margin_left = ${left}`,
    `patch_margin_top = ${top}`,
    `patch_margin_right = ${right}`,
    `patch_margin_bottom = ${bottom}`,
    `axis_stretch_horizontal = ${horizontal}`,
    `axis_stretch_vertical = ${vertical}`,
    ...(padding === undefined
      ? []
      : [
          `# Content padding (left, top, right, bottom): ${padding.left}, ${padding.top}, ${padding.right}, ${padding.bottom}`,
        ]),
    ...(note === '' ? [] : [`# ${note}`]),
  ].join('\n');
  return { files: [{ path: `${name}.tres`, contents: tres }], usage };
}

function godotString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ');
}
