import { axisTiles } from '../layout.js';
import { exportInsets, fixedAxisNote } from './common.js';
import type { ExportInput, ExportResult, SliceTarget } from './types.js';

export const unityTarget: SliceTarget = {
  id: 'unity',
  label: 'Unity',
  status: 'experimental',
  capabilities: { shapes: ['nine'], emulated: ['three', 'three-vertical'], tile: 'both' },
  exportLayout: exportUnity,
};

/**
 * Unity sprite border. Unity orders it left, bottom, right, top
 * (`Sprite.border` x, y, z, w) and tiles both axes with Image type Tiled.
 *
 * @evidence docs/spec.md#unity-sprite-border Writes the border in Unity's left, bottom, right, top order with the Sliced or Tiled image type.
 * @evidenceReview docs/spec.md#unity-sprite-border #3c32535 Checked this code against the section line by line and ran exportsUnitySpriteBorder green with pnpm test.
 */
export function exportUnity({ name, imageRef, layout }: ExportInput): Omit<ExportResult, 'target' | 'findings'> {
  const { left, top, right, bottom } = exportInsets(layout);
  const imageType = axisTiles(layout.x) || axisTiles(layout.y) ? 'Tiled' : 'Sliced';
  const settings = {
    sprite: imageRef,
    spriteBorder: { x: left, y: bottom, z: right, w: top },
    imageType,
  };
  return {
    files: [{ path: `${name}.unity.json`, contents: `${JSON.stringify(settings, null, 2)}\n` }],
    usage:
      `In the Sprite Editor set Border L ${left}, B ${bottom}, R ${right}, T ${top} ` +
      `(TextureImporter.spriteBorder = new Vector4(${left}, ${bottom}, ${right}, ${top})), ` +
      `then use Image type ${imageType}.` +
      fixedAxisNote(layout),
  };
}
