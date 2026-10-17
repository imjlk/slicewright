import { exportInsets, fixedAxisNote } from './common.js';
import type { ExportInput, ExportResult, SliceTarget } from './types.js';
import { oneLine } from './unity.js';

export const defoldTarget: SliceTarget = {
  id: 'defold',
  label: 'Defold',
  status: 'experimental',
  capabilities: {
    shapes: ['nine'],
    emulated: ['three', 'three-vertical'],
    tile: 'none',
    tileCount: 'floor',
  },
  outputs: () => [],
  exportLayout: exportDefold,
};

/**
 * Defold: `slice9` as left, top, right, bottom, for a sprite component or a
 * GUI box node, in the component file format and as Lua calls (the sprite
 * property is `slice`, the GUI one `slice9`). No file is written.
 *
 * @evidence docs/spec.md#experimental-targets Prints slice9 in Defold's left, top, right, bottom order for sprites and GUI box nodes, and writes no files.
 * @evidenceReview docs/spec.md#experimental-targets #de67bfb Checked this code against the section line by line and ran exportsExperimentalTargets green with pnpm test.
 */
export function exportDefold({
  name,
  imageRef,
  layout,
}: ExportInput): Omit<ExportResult, 'target' | 'findings'> {
  const { left, right, top, bottom } = exportInsets(layout);
  const padding = layout.content;
  const note = fixedAxisNote(layout).trim();
  const usage = [
    `-- slicewright: ${oneLine(name)} (${oneLine(imageRef)}), experimental`,
    '-- Sprite: Size Mode Manual, atlas image Sprite Trim Mode Off. GUI box node: Size Mode Manual.',
    '-- In the .sprite or .gui file:',
    `-- slice9 { x: ${left}.0 y: ${top}.0 z: ${right}.0 w: ${bottom}.0 }`,
    `go.set("#sprite", "slice", vmath.vector4(${left}, ${top}, ${right}, ${bottom}))`,
    `local node = gui.get_node("${luaString(name)}")`,
    'gui.set_size_mode(node, gui.SIZE_MODE_MANUAL)',
    `gui.set_slice9(node, vmath.vector4(${left}, ${top}, ${right}, ${bottom}))`,
    ...(padding === undefined
      ? []
      : [
          `-- Content padding (left, top, right, bottom): ${padding.left}, ${padding.top}, ${padding.right}, ${padding.bottom}`,
        ]),
    ...(note === '' ? [] : [`-- ${note}`]),
  ];
  return { files: [], usage: usage.join('\n') };
}

function luaString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ');
}
