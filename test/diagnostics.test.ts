import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { test } from 'node:test';

import { diagnosticMarkers, renderDiagnostics } from '../src/diagnostics.js';
import type { Finding } from '../src/inspect.js';
import { layoutFromInsets } from '../src/layout.js';
import { createRaster, pixelOffset } from '../src/raster.js';
import { renderPreviewSheet } from '../src/render.js';

/**
 * @evidence docs/spec.md#preview-diagnostics Marks nonuniform pairs, seam ends, and interior alpha pixels, and adds the cell only when something is marked.
 * @evidenceReview docs/spec.md#preview-diagnostics #bb4d822 Checked the assertions against the section and ran this test green with pnpm test.
 */
export function drawsDiagnostics(): void {
  const source = createRaster(12, 10);
  source.data.fill(255);
  source.data[pixelOffset(source, 5, 5) + 3] = 100;
  const findings: Finding[] = [
    {
      code: 'stretch.x.nonuniform',
      severity: 'error',
      message: '',
      details: { axis: 'x', pair: [4, 5] },
    },
    {
      code: 'tile.y.seam',
      severity: 'warning',
      message: '',
      details: { axis: 'y', span: { start: 3, end: 7 }, period: 3 },
    },
    {
      code: 'alpha.interior',
      severity: 'warning',
      message: '',
      details: { region: { x: 3, y: 2, width: 6, height: 5 } },
    },
    { code: 'noise.high', severity: 'warning', message: '' },
  ];
  const markers = diagnosticMarkers(source, findings);
  deepStrictEqual(
    markers.map((marker) => [marker.code, marker.kind, marker.rects.length]),
    [
      ['stretch.x.nonuniform', 'line', 2],
      ['tile.y.seam', 'line', 2],
      ['alpha.interior', 'pixel', 1],
    ],
  );
  deepStrictEqual(markers[1]?.rects[1], { x: 0, y: 6, width: 12, height: 1 });

  const drawn = renderDiagnostics(source, markers);
  deepStrictEqual(
    [...drawn.data.subarray(pixelOffset(drawn, 4, 0), pixelOffset(drawn, 4, 0) + 4)],
    [255, 32, 32, 255],
  );
  deepStrictEqual(
    [...drawn.data.subarray(pixelOffset(drawn, 5, 5), pixelOffset(drawn, 5, 5) + 4)],
    [255, 220, 0, 255],
  );
  deepStrictEqual(
    [...drawn.data.subarray(pixelOffset(drawn, 0, 0), pixelOffset(drawn, 0, 0) + 4)],
    [192, 192, 192, 255],
  );

  const layout = layoutFromInsets({ left: 2, right: 2, top: 2, bottom: 2 }, 12, 10);
  const sheet = renderPreviewSheet(source, layout, { findings });
  strictEqual(sheet.cells.at(-1)?.label, 'diagnostics');
  strictEqual(sheet.markers.length, 3);
  ok(!renderPreviewSheet(source, layout).cells.some((cell) => cell.label === 'diagnostics'));
  throws(() => renderPreviewSheet(source, layout, { cells: ['diagnostics'] }), /no finding marks/);
}

void test('preview diagnostics', drawsDiagnostics);
