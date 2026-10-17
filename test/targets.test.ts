import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';

import { layoutFromInsets } from '../src/layout.js';
import { exportForTarget, sliceTargets } from '../src/targets/index.js';
import { panel } from './fixtures.js';

function codes(findings: ReadonlyArray<{ readonly code: string }>): string[] {
  return findings.map((finding) => finding.code);
}

/**
 * @evidence docs/spec.md#experimental-targets Exports a nine-slice, a tiled panel, and a three-slice to Unity, Defold, and Godot, checking each engine's inset order, files, stretch modes, and experimental status.
 * @evidenceReview docs/spec.md#experimental-targets #de67bfb Checked the assertions against the section's orders, files, tiling, emulation, and res:// rules and ran this test green with pnpm test.
 */
export function exportsExperimentalTargets(): void {
  const raster = panel(40, 30);
  const layout = layoutFromInsets({ left: 6, right: 8, top: 5, bottom: 7 }, 40, 30, {
    content: { left: 4, right: 4, top: 3, bottom: 3 },
  });
  const input = { name: 'panel', imageRef: 'ui/panel.png', raster, layout };
  for (const id of ['unity', 'defold', 'godot']) {
    strictEqual(sliceTargets[id]?.status, 'experimental', id);
  }

  // Unity: x = left, y = bottom, z = right, w = top; values only, no files.
  const unity = exportForTarget('unity', input);
  deepStrictEqual(unity.files, []);
  deepStrictEqual(codes(unity.findings), ['target.experimental']);
  ok(unity.usage.includes('spriteBorder: {x: 6, y: 7, z: 8, w: 5}'));
  ok(unity.usage.includes('new Vector4(6, 7, 8, 5)'));
  ok(unity.usage.includes('importer.SaveAndReimport();'));
  ok(!exportForTarget('unity', { ...input, name: 'a\u2028b' }).usage.includes('\u2028'));
  ok(unity.usage.includes('Sliced'));
  ok(unity.usage.includes('RectOffset(4, 4, 3, 3)'));

  // Defold: left, top, right, bottom; no files.
  const defold = exportForTarget('defold', input);
  deepStrictEqual(defold.files, []);
  ok(defold.usage.includes('slice9 { x: 6.0 y: 5.0 z: 8.0 w: 7.0 }'));
  ok(defold.usage.includes('go.set("#sprite", "slice", vmath.vector4(6, 5, 8, 7))'));
  ok(defold.usage.includes('gui.set_size_mode(node, gui.SIZE_MODE_MANUAL)'));

  // Godot: a StyleBoxTexture with margins, content margins, and stretch modes.
  const godot = exportForTarget('godot', input);
  strictEqual(godot.files[0]?.path, 'panel.tres');
  const tres = String(godot.files[0]?.contents);
  ok(tres.startsWith('[gd_resource type="StyleBoxTexture"'));
  ok(tres.includes('[ext_resource type="Texture2D" path="res://ui/panel.png" id="1_texture"]'));
  for (const line of [
    'texture_margin_left = 6.0',
    'texture_margin_top = 5.0',
    'texture_margin_right = 8.0',
    'texture_margin_bottom = 7.0',
    'content_margin_left = 4.0',
    'axis_stretch_horizontal = 0',
    'axis_stretch_vertical = 0',
  ]) {
    ok(tres.includes(line), line);
  }
  ok(godot.usage.includes('patch_margin_bottom = 7'));
  ok(godot.usage.includes('Content padding (left, top, right, bottom): 4, 3, 4, 3'));
  const rooted = exportForTarget('godot', {
    ...input,
    imageRef: 'panel.png',
    loaderPaths: { image: 'ui/panel.png', directory: 'ui' },
  });
  ok(String(rooted.files[0]?.contents).includes('path="res://ui/panel.png"'));
  const resRef = exportForTarget('godot', { ...input, imageRef: 'res://art/panel.png' });
  ok(String(resRef.files[0]?.contents).includes('path="res://art/panel.png"'));

  // A tiled axis: Godot tiles per axis, Unity tiles both, Defold cannot tile.
  const tiled = layoutFromInsets({ left: 6, right: 6, top: 6, bottom: 6 }, 40, 30, {
    tile: { x: true, y: false },
  });
  const tiledInput = { ...input, layout: tiled };
  ok(
    String(exportForTarget('godot', tiledInput).files[0]?.contents).includes(
      'axis_stretch_horizontal = 2',
    ),
  );
  ok(codes(exportForTarget('godot', tiledInput).findings).includes('target.tile'));
  const unityTiled = exportForTarget('unity', tiledInput);
  ok(unityTiled.usage.includes('Tiled'));
  strictEqual(codes(unityTiled.findings).filter((code) => code === 'target.tile').length, 2);
  ok(codes(exportForTarget('defold', tiledInput).findings).includes('target.tile'));

  // A three-slice is emulated with zero insets on the fixed height.
  const three = layoutFromInsets({ left: 6, right: 6, top: 0, bottom: 0 }, 40, 30, {
    shape: 'three',
  });
  for (const id of ['unity', 'defold', 'godot']) {
    const result = exportForTarget(id, { ...input, layout: three });
    ok(codes(result.findings).includes('target.emulated'), id);
    ok(result.usage.includes('Keep the height at 30 px.'), id);
  }
}

void test('experimental targets', exportsExperimentalTargets);
