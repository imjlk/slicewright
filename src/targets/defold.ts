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
  exportLayout: exportDefold,
};

/**
 * Defold: `slice9` as left, top, right, bottom, for a sprite component or a
 * GUI box node, in the component file format and as a Lua call. No file is
 * written.
 *
 * @evidence docs/spec.md#experimental-targets Prints slice9 in Defold's left, top, right, bottom order for sprites and GUI box nodes, and writes no files.
 * @evidenceReview docs/spec.md#experimental-targets #dc0943d Checked this code against the section line by line and ran exportsExperimentalTargets green with pnpm test.
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
    '-- Sprite: Size Mode Manual; atlas image Sprite Trim Mode Off. In the .sprite or .gui file:',
    `-- slice9 { x: ${left}.0 y: ${top}.0 z: ${right}.0 w: ${bottom}.0 }`,
    `go.set("#sprite", "slice9", vmath.vector4(${left}, ${top}, ${right}, ${bottom}))`,
    `gui.set_slice9(gui.get_node("${luaString(name)}"), vmath.vector4(${left}, ${top}, ${right}, ${bottom}))`,
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
