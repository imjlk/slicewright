import { flexibleSegments, type AxisLayout } from '../layout.js';
import { encodePng } from '../png.js';
import { createRaster, pixelOffset } from '../raster.js';
import type { ExportInput, ExportResult, SliceTarget } from './types.js';

const guide = [0, 0, 0, 255] as const;

export const ninePatchTarget: SliceTarget = {
  id: 'ninepatch',
  label: 'Android nine-patch',
  capabilities: {
    shapes: ['nine', 'multi'],
    emulated: ['three', 'three-vertical'],
    tile: 'none',
  },
  exportLayout: exportNinePatch,
};

/**
 * Android nine-patch (`.9.png`): the image inside a 1 px frame whose top and
 * left lines mark stretchable columns and rows in opaque black. Any number of
 * regions per axis; a fixed axis is marked whole. No padding lines.
 *
 * @evidence docs/spec.md#android-nine-patch Draws the guide frame around the image with every flexible region marked, a fixed axis marked whole.
 * @evidenceReview docs/spec.md#android-nine-patch #3191914 Checked this code against the section line by line and ran exportsAndroidNinePatch green with pnpm test.
 */
export function exportNinePatch({ name, raster, layout }: ExportInput): Omit<ExportResult, 'target' | 'findings'> {
  const out = createRaster(raster.width + 2, raster.height + 2);
  for (let y = 0; y < raster.height; y += 1) {
    const from = pixelOffset(raster, 0, y);
    out.data.set(raster.data.subarray(from, from + raster.width * 4), pixelOffset(out, 1, y + 1));
  }
  for (const x of stretchLines(layout.x)) {
    out.data.set(guide, pixelOffset(out, x + 1, 0));
  }
  for (const y of stretchLines(layout.y)) {
    out.data.set(guide, pixelOffset(out, 0, y + 1));
  }
  return {
    files: [{ path: `${name}.9.png`, contents: encodePng(out) }],
    usage: `Put ${name}.9.png in res/drawable and use it as a background; Android stretches the marked lines.`,
  };
}

function stretchLines(axis: AxisLayout): number[] {
  const flexible = flexibleSegments(axis);
  const spans = flexible.length === 0 ? [{ start: 0, end: axis.length }] : flexible;
  return spans.flatMap((span) =>
    Array.from({ length: span.end - span.start }, (_, index) => span.start + index),
  );
}
