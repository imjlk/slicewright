import type { Finding } from '../inspect.js';
import { axisTiles, type SliceLayout } from '../layout.js';
import { exportInsets, fixedAxisNote } from './common.js';
import type { ExportInput, ExportResult, SliceTarget } from './types.js';

export const unityTarget: SliceTarget = {
  id: 'unity',
  label: 'Unity',
  status: 'experimental',
  capabilities: {
    shapes: ['nine'],
    emulated: ['three', 'three-vertical'],
    tile: 'both',
    tileCount: 'floor',
  },
  check: checkUnityLayout,
  exportLayout: exportUnity,
};

/**
 * Unity's Tiled draw mode repeats whole tiles from the corner and clips the
 * last one instead of fitting a whole number of tiles.
 *
 * @evidence docs/spec.md#experimental-targets Warns that Unity clips the last tile of a tiled span.
 * @evidenceReview docs/spec.md#experimental-targets #0f54f66 Checked this code against the section line by line and ran exportsExperimentalTargets green with pnpm test.
 */
export function checkUnityLayout(layout: SliceLayout): Finding[] {
  return axisTiles(layout.x) || axisTiles(layout.y)
    ? [
        {
          code: 'target.tile',
          severity: 'warning',
          message:
            'Unity Tiled mode repeats whole tiles and clips the last one, so the tiled span does not end on a whole tile.',
        },
      ]
    : [];
}

/**
 * Unity: the sprite border as `TextureImporter.spriteBorder` takes it,
 * `x = left`, `y = bottom`, `z = right`, `w = top`, with an editor script line
 * that sets it. No file is written; slicewright never touches `.meta` files.
 *
 * @evidence docs/spec.md#experimental-targets Prints the spriteBorder vector in Unity's left, bottom, right, top order and the draw mode, and writes no files.
 * @evidenceReview docs/spec.md#experimental-targets #0f54f66 Checked this code against the section line by line and ran exportsExperimentalTargets green with pnpm test.
 */
export function exportUnity({
  name,
  imageRef,
  layout,
}: ExportInput): Omit<ExportResult, 'target' | 'findings'> {
  const { left, right, top, bottom } = exportInsets(layout);
  const tiled = axisTiles(layout.x) || axisTiles(layout.y);
  const padding = layout.content;
  const lines = [
    `// slicewright: ${oneLine(name)} (${oneLine(imageRef)}), experimental`,
    '// Sprite Editor border, or TextureImporter.spriteBorder (x = left, y = bottom, z = right, w = top):',
    `// spriteBorder: {x: ${left}, y: ${bottom}, z: ${right}, w: ${top}}`,
    `importer.spriteBorder = new Vector4(${left}, ${bottom}, ${right}, ${top});`,
    '// Mesh Type Full Rect; then Image.type or SpriteRenderer.drawMode:',
    `// ${tiled ? 'Image.Type.Tiled / SpriteDrawMode.Tiled' : 'Image.Type.Sliced / SpriteDrawMode.Sliced'}`,
    ...(padding === undefined
      ? []
      : [
          `// Content padding (left, right, top, bottom): RectOffset(${padding.left}, ${padding.right}, ${padding.top}, ${padding.bottom})`,
        ]),
  ];
  const note = fixedAxisNote(layout).trim();
  return {
    files: [],
    usage: [...lines, ...(note === '' ? [] : [`// ${note}`])].join('\n'),
  };
}

/** Caller data kept on one comment line. */
export function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}
