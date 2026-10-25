import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { test } from 'node:test';

import { defaultChromaOptions, detectChromaKey, removeChroma } from '../src/chroma.js';
import { defaultInspectOptions } from '../src/inspect.js';
import { normalizeRaster } from '../src/normalize.js';
import { outlineThickness } from '../src/outline.js';
import { createRaster, pixelOffset, type Raster } from '../src/raster.js';
import { renderLayout, renderSlices } from '../src/render.js';
import { resizeRaster, targetSize } from '../src/resize.js';
import {
  crestPanel,
  fill,
  fillRect,
  outline,
  panel,
  sameRaster,
  setPixel,
  shadedBar,
} from './fixtures.js';

function pixel(raster: Raster, x: number, y: number): number[] {
  const offset = pixelOffset(raster, x, y);
  return Array.from(raster.data.subarray(offset, offset + 4));
}

/**
 * @evidence docs/spec.md#chroma-removal Keys green and magenta backgrounds, fades the blend band, despills the edge, and refuses an image with no key.
 * @evidenceReview docs/spec.md#chroma-removal #594a7cd Checked the assertions against the section and ran this test green with pnpm test.
 */
export function removesChromaBackgrounds(): void {
  const keyed = createRaster(12, 8);
  fillRect(keyed, 0, 0, 12, 8, [0, 255, 0, 255]);
  fillRect(keyed, 3, 2, 6, 4, outline);
  // A blend of the outline and the key, as anti-aliasing leaves it.
  setPixel(keyed, 2, 3, [40, 130, 20, 255]);
  // Slightly green but far below the keep threshold, next to the edge.
  setPixel(keyed, 3, 2, [60, 80, 40, 255]);

  strictEqual(detectChromaKey(keyed), 'green');
  const result = removeChroma(keyed);
  strictEqual(result.key, 'green');
  deepStrictEqual(pixel(result.raster, 0, 0), [0, 0, 0, 0]);
  deepStrictEqual(pixel(result.raster, 5, 4), [...outline]);
  const blend = pixel(result.raster, 2, 3);
  ok((blend[3] ?? 0) > 0 && (blend[3] ?? 0) < 255);
  ok((blend[1] ?? 0) <= Math.max(blend[0] ?? 0, blend[2] ?? 0));
  deepStrictEqual(pixel(result.raster, 3, 2), [60, 60, 40, 255]);
  ok(result.cleared > 0 && result.softened > 0 && result.despilled > 0);

  const magenta = createRaster(6, 6);
  fillRect(magenta, 0, 0, 6, 6, [255, 0, 255, 255]);
  fillRect(magenta, 2, 2, 2, 2, fill);
  setPixel(magenta, 2, 2, [80, 50, 85, 255]);
  const keyedMagenta = removeChroma(magenta);
  strictEqual(keyedMagenta.key, 'magenta');
  deepStrictEqual(pixel(keyedMagenta.raster, 0, 0), [0, 0, 0, 0]);
  deepStrictEqual(pixel(keyedMagenta.raster, 2, 2), [50, 50, 55, 255]);

  throws(() => removeChroma(panel(20, 16)), /No chroma key/);
  throws(() => removeChroma(keyed, { ...defaultChromaOptions, keep: 90, drop: 80 }), RangeError);
  throws(() => removeChroma(keyed, { ...defaultChromaOptions, despillRadius: 1.5 }), RangeError);
  throws(
    () => removeChroma(keyed, { ...defaultChromaOptions, despillRadius: Infinity }),
    RangeError,
  );
}

/**
 * @evidence docs/spec.md#resizing Averages in premultiplied alpha without colour halos, keeps uniform areas exact, samples nearest pixels, and fits target sizes.
 * @evidenceReview docs/spec.md#resizing #66688ff Checked the assertions against the section and ran this test green with pnpm test.
 */
export function resizesWithoutHalos(): void {
  const edge = createRaster(2, 1);
  setPixel(edge, 0, 0, [255, 0, 0, 255]);
  setPixel(edge, 1, 0, [0, 255, 0, 0]);
  deepStrictEqual(pixel(resizeRaster(edge, 1, 1), 0, 0), [255, 0, 0, 128]);

  const checker = createRaster(4, 4);
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      setPixel(checker, x, y, (x + y) % 2 === 0 ? [200, 200, 200, 255] : [100, 100, 100, 255]);
    }
  }
  deepStrictEqual(pixel(resizeRaster(checker, 2, 2), 1, 1), [150, 150, 150, 255]);
  deepStrictEqual(pixel(resizeRaster(checker, 2, 2, 'nearest'), 0, 0), [200, 200, 200, 255]);

  const third = resizeRaster(panel(60, 45), 20, 15);
  deepStrictEqual(pixel(third, 10, 7), [...fill]);

  const upscaled = resizeRaster(checker, 8, 8);
  deepStrictEqual(pixel(upscaled, 1, 1), pixel(checker, 0, 0));

  deepStrictEqual(targetSize(400, 200, { width: 100 }), { width: 100, height: 50 });
  deepStrictEqual(targetSize(400, 200, { height: 50 }), { width: 100, height: 50 });
  deepStrictEqual(targetSize(400, 200, { scale: 0.25 }), { width: 100, height: 50 });
  deepStrictEqual(targetSize(400, 200, { width: 90, height: 30 }), { width: 90, height: 30 });
  throws(() => resizeRaster(checker, 0, 4), RangeError);
  for (const request of [
    { scale: 0 },
    { scale: -1 },
    { scale: Number.NaN },
    { width: 1.5 },
    { height: 0 },
    { scale: 2, width: 100 },
  ]) {
    throws(() => targetSize(400, 200, request), RangeError);
  }
}

/**
 * @evidence docs/spec.md#normalization Crops and resizes before inspecting, rebuilds uniform axes losslessly, including each span of a multi-region layout, and leaves a three-slice height alone.
 * @evidenceReview docs/spec.md#normalization #ca5cb61 Checked the assertions against the section and ran this test green with pnpm test.
 */
export function normalizesGeneratedArt(): void {
  const target = panel(40, 30);
  const generated = resizeRaster(panel(40, 30, 3), 92, 72, 'nearest');
  // A faint shadow pixel in the margin must not hold the crop open.
  setPixel(generated, 1, 70, [0, 0, 0, 6]);

  const plain = normalizeRaster(generated, {
    inspect: defaultInspectOptions,
    crop: true,
    width: 40,
    filter: 'nearest',
  });
  deepStrictEqual(
    plain.steps.map((step) => step.step),
    ['crop', 'resize'],
  );
  ok(sameRaster(plain.raster, target));
  deepStrictEqual(plain.report.insets, { left: 6, right: 6, top: 6, bottom: 6 });

  const rebuilt = normalizeRaster(generated, {
    inspect: defaultInspectOptions,
    crop: true,
    width: 40,
    filter: 'nearest',
    keep: 2,
  });
  deepStrictEqual([rebuilt.raster.width, rebuilt.raster.height], [14, 14]);
  strictEqual(rebuilt.report.ok, true);
  deepStrictEqual(rebuilt.report.scale9Borders, { x: 6, y: 6, w: 2, h: 2 });
  ok(rebuilt.report.findings.some((item) => item.code === 'rebuild.filtering'));
  deepStrictEqual(rebuilt.steps.at(-1)?.to, { width: 14, height: 14 });
  ok(sameRaster(renderSlices(rebuilt.raster, rebuilt.report.insets, 40, 30), target));

  const bar = normalizeRaster(shadedBar(48, 12), {
    inspect: defaultInspectOptions,
    crop: true,
    filter: 'area',
    keep: 3,
  });
  strictEqual(bar.report.mode, 'three');
  deepStrictEqual([bar.raster.width, bar.raster.height], [13, 12]);

  // A vertical gradient stretches fine but cannot be cut to two rows.
  const shaded = panel(40, 30);
  for (let y = 6; y < 24; y += 1) {
    fillRect(shaded, 6, y, 28, 1, [90 + y * 3, 60, 40, 255]);
  }
  const lossy = normalizeRaster(shaded, {
    inspect: { ...defaultInspectOptions, tolerance: 4 },
    crop: true,
    filter: 'area',
    keep: 2,
  });
  deepStrictEqual([lossy.raster.width, lossy.raster.height], [14, 30]);
  const warning = lossy.report.findings.find((item) => item.code === 'rebuild.y.lossy');
  strictEqual(warning?.severity, 'warning');
  strictEqual(
    lossy.report.findings.some((item) => item.code === 'rebuild.x.lossy'),
    false,
  );

  const broken = normalizeRaster(panel(40, 30), {
    inspect: { ...defaultInspectOptions, insets: { left: 2, right: 2, top: 6, bottom: 6 } },
    crop: true,
    filter: 'area',
    keep: 2,
  });
  strictEqual(broken.report.ok, false);
  strictEqual(broken.raster.width, 40);
  // An invalid keep is refused even when inspection would stop early.
  throws(
    () =>
      normalizeRaster(panel(40, 30), {
        inspect: { ...defaultInspectOptions, insets: { left: 2, right: 2, top: 6, bottom: 6 } },
        crop: true,
        filter: 'area',
        keep: 0,
      }),
    RangeError,
  );

  // A multi-region layout keeps the crest between its spans and each span's first lines.
  const crest = crestPanel(96, 40);
  const multi = normalizeRaster(crest, {
    inspect: { ...defaultInspectOptions, regions: 'multi' },
    crop: true,
    filter: 'area',
    keep: 2,
  });
  strictEqual(multi.report.mode, 'multi');
  strictEqual(multi.steps.at(-1)?.step, 'rebuild');
  const kept = multi.report.layout.x.segments.filter((segment) => segment.kind === 'stretch');
  strictEqual(kept.length, 2);
  ok(kept.every((segment) => segment.end - segment.start === 2));
  strictEqual(multi.report.layout.x.length, multi.raster.width);
  strictEqual(multi.report.width, multi.raster.width);
  ok(sameRaster(renderLayout(multi.raster, multi.report.layout, 96, 40), crest));

  // A 2 px outline drawn straight onto the fill fades at a fifth of the size.
  const outlined = (border: number): Raster => {
    const art = createRaster(200, 120);
    fillRect(art, 0, 0, 200, 120, [200, 200, 200, 255]);
    fillRect(art, border, border, 200 - border * 2, 120 - border * 2, [20, 20, 20, 255]);
    return art;
  };
  const thinOptions = { inspect: defaultInspectOptions, crop: true, filter: 'area' as const };
  const thin = normalizeRaster(outlined(2), { ...thinOptions, width: 40 });
  const finding = thin.report.findings.find((item) => item.code === 'resize.thin-lines');
  strictEqual(finding?.severity, 'warning');
  deepStrictEqual(finding?.details, {
    left: [2, 2, 2, 2, 2],
    right: [2, 2, 2, 2, 2],
    top: [2, 2, 2, 2, 2],
    bottom: [2, 2, 2, 2, 2],
  });
  // Wide enough for the factor, or a factor below 2, keeps the line.
  const codesOf = (result: ReturnType<typeof normalizeRaster>): string[] =>
    result.report.findings.map((item) => item.code);
  strictEqual(
    codesOf(normalizeRaster(outlined(4), { ...thinOptions, width: 40 })).includes(
      'resize.thin-lines',
    ),
    false,
  );
  strictEqual(
    codesOf(normalizeRaster(outlined(2), { ...thinOptions, width: 120 })).includes(
      'resize.thin-lines',
    ),
    false,
  );
  // Nearest sampling can drop any line narrower than the factor.
  ok(
    codesOf(normalizeRaster(outlined(4), { ...thinOptions, filter: 'nearest', width: 40 })).includes(
      'resize.thin-lines',
    ),
  );
  // A thin highlight on a thick rim is not reported: the rim still marks the border.
  const rimmed = outlined(2);
  fillRect(rimmed, 2, 2, 196, 116, [120, 80, 40, 255]);
  fillRect(rimmed, 16, 16, 168, 88, [20, 20, 20, 255]);
  strictEqual(
    codesOf(normalizeRaster(rimmed, { ...thinOptions, width: 40 })).includes('resize.thin-lines'),
    false,
  );
  // A double stroke (dark outline, light inner line) still reaches the fill.
  const doubled = outlined(2);
  fillRect(doubled, 0, 0, 200, 120, [30, 30, 30, 255]);
  fillRect(doubled, 2, 2, 196, 116, [240, 240, 240, 255]);
  fillRect(doubled, 4, 4, 192, 112, [40, 80, 160, 255]);
  ok(
    codesOf(normalizeRaster(doubled, { ...thinOptions, width: 40 })).includes('resize.thin-lines'),
  );
  // So does a line on translucent glass, or around an empty center.
  const glass = outlined(2);
  fillRect(glass, 2, 2, 196, 116, [40, 80, 160, 120]);
  ok(codesOf(normalizeRaster(glass, { ...thinOptions, width: 40 })).includes('resize.thin-lines'));
  const hollow = outlined(2);
  fillRect(hollow, 2, 2, 196, 116, [0, 0, 0, 0]);
  ok(codesOf(normalizeRaster(hollow, { ...thinOptions, width: 40 })).includes('resize.thin-lines'));
  // Each axis uses its own factor: only the axis shrunk enough is reported.
  const squeezed = normalizeRaster(outlined(2), { ...thinOptions, width: 40, height: 100 });
  const squeezedFinding = squeezed.report.findings.find(
    (item) => item.code === 'resize.thin-lines',
  );
  deepStrictEqual(Object.keys(squeezedFinding?.details ?? {}), ['left', 'right']);
  // A warning: the report stays ok.
  strictEqual(thin.report.ok, true);
}

/** Paints a pixel as ink (dark) and paper (light) shares of `total` samples, in straight alpha. */
function paintMix(art: Raster, x: number, y: number, ink: number, paper: number, total: number): void {
  const covered = ink + paper;
  if (covered === 0) {
    return;
  }
  const value = Math.round((ink * 20 + paper * 250) / covered);
  setPixel(art, x, y, [value, value, value, Math.round((covered / total) * 255)]);
}

/** A ring of radius 100 with an outline `stroke` px thick, anti-aliased by supersampling, plus optional noise. */
function ring(stroke: number, noise = 0): Raster {
  const art = createRaster(220, 220);
  const samples = 4;
  let seed = 7;
  const random = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let y = 0; y < 220; y += 1) {
    for (let x = 0; x < 220; x += 1) {
      let ink = 0;
      let paper = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const r = Math.hypot(x + (sx + 0.5) / samples - 110, y + (sy + 0.5) / samples - 110);
          if (r <= 100) {
            if (r > 100 - stroke) {
              ink += 1;
            } else {
              paper += 1;
            }
          }
        }
      }
      paintMix(art, x, y, ink, paper, samples * samples);
      if (noise > 0 && ink + paper > 0) {
        const at = pixelOffset(art, x, y);
        for (let channel = 0; channel < 3; channel += 1) {
          const shifted = (art.data[at + channel] ?? 0) + Math.round((random() * 2 - 1) * noise);
          art.data[at + channel] = Math.min(255, Math.max(0, shifted));
        }
      }
    }
  }
  return art;
}

/** A downward tail: slanted sides outlined `stroke` px thick, no outline along the top. */
function tail(stroke: number, samples = 1): Raster {
  const art = createRaster(120, 100);
  // Edges from the top corners to the tip at (60, 100), as a x + b y + c = 0.
  const edges = [
    [100, -60, 0],
    [100, 60, -12000],
  ] as const;
  // Supersampled, so `samples` above 1 anti-aliases the edges.
  for (let y = 0; y < 100; y += 1) {
    for (let x = 0; x < 120; x += 1) {
      let ink = 0;
      let paper = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = x + (sx + 0.5) / samples;
          const py = y + (sy + 0.5) / samples;
          const distances = edges.map(([a, b, c]) => (a * px + b * py + c) / Math.hypot(a, b));
          if ((distances[0] ?? 0) >= 0 && (distances[1] ?? 0) <= 0) {
            const nearest = Math.min(Math.abs(distances[0] ?? 0), Math.abs(distances[1] ?? 0));
            if (nearest < stroke) {
              ink += 1;
            } else {
              paper += 1;
            }
          }
        }
      }
      paintMix(art, x, y, ink, paper, samples * samples);
    }
  }
  return art;
}

/**
 * @evidence docs/spec.md#resizing Measures straight and slanted outlines perpendicular to the stroke, refuses art without an outline, and gives the scale that matches two outlines.
 * @evidenceReview docs/spec.md#resizing #66688ff Checked the assertions against the section and ran this test green with pnpm test.
 */
export function matchesOutlineThickness(): void {
  const body = createRaster(200, 120);
  fillRect(body, 0, 0, 200, 120, [20, 20, 20, 255]);
  fillRect(body, 6, 6, 188, 108, [250, 250, 250, 255]);
  const bodyThickness = outlineThickness(body) ?? 0;
  ok(Math.abs(bodyThickness - 6) < 0.5, `body ${bodyThickness}`);
  // Slanted sides measure perpendicular to the stroke, not along a row.
  const tailThickness = outlineThickness(tail(12)) ?? 0;
  ok(Math.abs(tailThickness - 12) < 1.5, `tail ${tailThickness}`);
  // A flat fill has no outline to measure.
  const flat = createRaster(60, 40);
  fillRect(flat, 0, 0, 60, 40, fill);
  strictEqual(outlineThickness(flat), undefined);
  // Round, anti-aliased, and noisy outlines measure across the stroke; noise
  // below half the contrast does not cut the stroke short.
  for (const noise of [0, 30]) {
    const measured = outlineThickness(ring(8, noise)) ?? 0;
    ok(Math.abs(measured - 8) < 1, `ring noise ${noise}: ${measured}`);
  }
  // Thin anti-aliased slanted sides count their edge pixels in part.
  for (const stroke of [2, 3]) {
    const measured = outlineThickness(tail(stroke, 4)) ?? 0;
    ok(Math.abs(measured - stroke) < 0.6, `tail ${stroke}: ${measured}`);
  }
  // An outline thicker than a quarter of the image still has an inside to compare.
  const thick = createRaster(300, 300);
  fillRect(thick, 0, 0, 300, 300, [20, 20, 20, 255]);
  fillRect(thick, 80, 80, 140, 140, [250, 250, 250, 255]);
  const thickness = outlineThickness(thick) ?? 0;
  ok(Math.abs(thickness - 80) / 80 < 0.05, `thick ${thickness}`);
  // The tail scaled by the ratio ends up with the body's outline.
  const scale = bodyThickness / tailThickness;
  const size = targetSize(120, 100, { scale });
  const matched = outlineThickness(resizeRaster(tail(12), size.width, size.height, 'area')) ?? 0;
  ok(Math.abs(matched - 6) < 1.5, `matched ${matched}`);
}

void test('chroma removal', removesChromaBackgrounds);
void test('resizing', resizesWithoutHalos);
void test('normalization', normalizesGeneratedArt);
void test('outline matching', matchesOutlineThickness);
