import { contentBounds } from './detect.js';
import {
  defaultInspectOptions,
  inspectRaster,
  type Finding,
  type InspectOptions,
  type InspectReport,
} from './inspect.js';
import {
  createRaster,
  cropRaster,
  pixelOffset,
  rasterDifference,
  type Raster,
  type Rect,
} from './raster.js';
import {
  layoutFromInsets,
  minimumLayoutSize,
  type AxisLayout,
  type Segment,
  type SliceLayout,
} from './layout.js';
import { renderLayout } from './render.js';
import { resizeRaster, targetSize, type ResizeFilter } from './resize.js';
import { insetsToScale9Borders, type SliceInsets } from './slices.js';
import { thinLineFindings } from './thin-lines.js';

export interface NormalizeOptions {
  readonly inspect: InspectOptions;
  /** Crop fully transparent margins before resizing. */
  readonly crop: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly scale?: number;
  readonly filter: ResizeFilter;
  /** Stretch-span length to keep per axis; undefined keeps the spans whole. */
  readonly keep?: number;
}

export interface NormalizeStep {
  readonly step: 'crop' | 'resize' | 'rebuild';
  readonly from: { readonly width: number; readonly height: number };
  readonly to: { readonly width: number; readonly height: number };
}

export interface NormalizeResult {
  readonly raster: Raster;
  readonly steps: readonly NormalizeStep[];
  readonly report: InspectReport;
}

/** Below this keep length, linear filtering visibly fades the kept lines. */
const linearFilterKeep = 8;

/** Alpha at or below this, out of 255, does not hold the first crop open. */
const cropAlpha = 8;

export const defaultNormalizeOptions: NormalizeOptions = {
  inspect: defaultInspectOptions,
  crop: true,
  filter: 'area',
};

/**
 * Crops margins, resizes to the in-game size, picks insets at that size, and
 * optionally rebuilds a smaller texture that keeps `keep` pixels of each
 * uniform stretch span.
 *
 * @evidence docs/spec.md#normalization Orders crop, resize, inspection, and rebuild, and rebuilds only uniform axes.
 * @evidenceReview docs/spec.md#normalization #ca5cb61 Checked this code against the section line by line and ran normalizesGeneratedArt green with pnpm test.
 */
export function normalizeRaster(
  source: Raster,
  options: NormalizeOptions = defaultNormalizeOptions,
): NormalizeResult {
  if (options.keep !== undefined && (!Number.isInteger(options.keep) || options.keep < 1)) {
    throw new RangeError(`--keep must be a positive integer, got ${options.keep}.`);
  }
  const steps: NormalizeStep[] = [];
  let raster = source;

  if (options.crop) {
    raster = cropTo(raster, contentBounds(raster, cropAlpha), steps);
  }

  const size = targetSize(raster.width, raster.height, options);
  let thinLines: Finding[] = [];
  if (size.width !== raster.width || size.height !== raster.height) {
    // Judged on the cropped source, before averaging hides the lines.
    thinLines = thinLineFindings(
      raster,
      { x: raster.width / size.width, y: raster.height / size.height },
      options.filter,
    );
    const resized = resizeRaster(raster, size.width, size.height, options.filter);
    steps.push(step('resize', raster, resized));
    raster = resized;
    if (options.crop) {
      // Faint pixels kept by the first crop can average to nothing.
      raster = cropTo(raster, contentBounds(raster), steps);
    }
  }

  const inspected = inspectRaster(raster, options.inspect);
  const report = { ...inspected, findings: [...inspected.findings, ...thinLines] };
  if (options.keep === undefined || !report.ok) {
    return { raster, steps, report };
  }

  const findings: Finding[] = [];
  const keepAxis = (axis: 'x' | 'y'): number | undefined => {
    if (
      report.tile[axis] ||
      (axis === 'y' && report.mode === 'three') ||
      (axis === 'x' && report.mode === 'three-vertical') ||
      report.findings.some(
        (finding) =>
          finding.code === `stretch.${axis}.none` || finding.code === `stretch.${axis}.short`,
      )
    ) {
      return undefined;
    }
    const keep = { x: undefined, y: undefined, [axis]: options.keep };
    const candidate = rebuildLayout(raster, report.layout, keep);
    const back = renderLayout(candidate.raster, candidate.layout, raster.width, raster.height);
    const difference = rasterDifference(back, raster);
    // The exact tolerance, not the noise-raised one: cutting a span drops every
    // line it removes, so noise the matching forgave becomes lost texture.
    if (difference.p99 <= options.inspect.tolerance) {
      return options.keep;
    }
    findings.push({
      code: `rebuild.${axis}.lossy`,
      severity: 'warning',
      message: `Keeping ${options.keep} lines of the ${axis} span would flatten texture or shading (99th percentile difference ${Math.round(difference.p99)} above ${options.inspect.tolerance}), so that axis keeps its full span.`,
      details: { axis, keep: options.keep, ...difference },
    });
    return undefined;
  };
  const rebuilt = rebuildLayout(raster, report.layout, { x: keepAxis('x'), y: keepAxis('y') });
  if (rebuilt.raster.width === raster.width && rebuilt.raster.height === raster.height) {
    return { raster, steps, report: { ...report, findings: [...report.findings, ...findings] } };
  }
  steps.push(step('rebuild', raster, rebuilt.raster));
  if (options.keep < linearFilterKeep) {
    findings.push({
      code: 'rebuild.filtering',
      severity: 'info',
      message: `With linear texture filtering the engine blends the ${options.keep} kept lines into their neighbors over about stretched-span / ${options.keep * 2} pixels at each end. Use nearest filtering (Phaser pixelArt) or --keep ${linearFilterKeep} or more.`,
    });
  }
  // The layout was verified on the full image; re-detecting on the rebuilt one
  // would judge mostly-corner pixels against the full image's noise floor.
  const { width, height } = rebuilt.raster;
  if (report.mode === 'multi') {
    // Several spans per axis: the rebuilt layout is the only description of them.
    return {
      raster: rebuilt.raster,
      steps,
      report: {
        ...report,
        width,
        height,
        scale9Borders: insetsToScale9Borders(report.insets, width, height),
        layout: rebuilt.layout,
        minSize: minimumLayoutSize({ x: rebuilt.layout.x, y: rebuilt.layout.y }),
        contentBounds: contentBounds(rebuilt.raster) ?? null,
        findings: [...report.findings, ...findings],
      },
    };
  }
  return {
    raster: rebuilt.raster,
    steps,
    report: {
      ...report,
      width,
      height,
      scale9Borders: insetsToScale9Borders(report.insets, width, height),
      layout: layoutFromInsets(report.insets, width, height, {
        shape: report.mode,
        tile: report.tile,
        ...(report.layout.content === undefined ? {} : { content: report.layout.content }),
      }),
      minSize: minimumLayoutSize(
        layoutFromInsets(report.insets, width, height, {
          shape: report.mode,
          tile: report.tile,
        }),
      ),
      contentBounds: contentBounds(rebuilt.raster) ?? null,
      findings: [...report.findings, ...findings],
    },
  };
}

/**
 * Keeps the fixed borders and the first `keep` lines of each stretch span.
 * Lossless when the span is uniform: every dropped line equals a kept one.
 *
 * @evidence docs/spec.md#normalization Copies the borders and the first kept lines of each span.
 * @evidenceReview docs/spec.md#normalization #ca5cb61 Checked this code against the section line by line and ran normalizesGeneratedArt green with pnpm test.
 */
export function rebuildSlices(
  raster: Raster,
  insets: SliceInsets,
  keep: { readonly x: number | undefined; readonly y: number | undefined },
): { raster: Raster; insets: SliceInsets } {
  const columns = keptLines(raster.width, insets.left, insets.right, keep.x);
  const rows = keptLines(raster.height, insets.top, insets.bottom, keep.y);
  const out = createRaster(columns.length, rows.length);
  rows.forEach((sourceY, y) => {
    columns.forEach((sourceX, x) => {
      const from = pixelOffset(raster, sourceX, sourceY);
      out.data.set(raster.data.subarray(from, from + 4), pixelOffset(out, x, y));
    });
  });
  return { raster: out, insets };
}

/**
 * Keeps every fixed and tiled segment and the first `keep` lines of each
 * stretch segment on an axis with a keep length, and returns the shifted
 * layout. Lossless when each stretch segment is uniform.
 *
 * @evidence docs/spec.md#normalization Copies fixed segments and the first kept lines of every stretch segment, for any number of regions.
 * @evidenceReview docs/spec.md#normalization #ca5cb61 Checked this code against the section line by line and ran normalizesGeneratedArt green with pnpm test.
 */
export function rebuildLayout(
  raster: Raster,
  layout: SliceLayout,
  keep: { readonly x: number | undefined; readonly y: number | undefined },
): { raster: Raster; layout: SliceLayout } {
  const x = keptAxis(layout.x, keep.x);
  const y = keptAxis(layout.y, keep.y);
  const out = createRaster(x.lines.length, y.lines.length);
  y.lines.forEach((sourceY, row) => {
    x.lines.forEach((sourceX, column) => {
      const from = pixelOffset(raster, sourceX, sourceY);
      out.data.set(raster.data.subarray(from, from + 4), pixelOffset(out, column, row));
    });
  });
  return {
    raster: out,
    layout: {
      x: x.axis,
      y: y.axis,
      ...(layout.content === undefined ? {} : { content: layout.content }),
    },
  };
}

function keptAxis(
  axis: AxisLayout,
  keep: number | undefined,
): { lines: number[]; axis: AxisLayout } {
  const lines: number[] = [];
  const segments: Segment[] = [];
  for (const segment of axis.segments) {
    const length = segment.end - segment.start;
    const kept = keep !== undefined && segment.kind === 'stretch' ? Math.min(keep, length) : length;
    segments.push({ start: lines.length, end: lines.length + kept, kind: segment.kind });
    for (let index = 0; index < kept; index += 1) {
      lines.push(segment.start + index);
    }
  }
  return { lines, axis: { length: lines.length, segments } };
}

function cropTo(raster: Raster, bounds: Rect | undefined, steps: NormalizeStep[]): Raster {
  if (bounds === undefined || (bounds.width === raster.width && bounds.height === raster.height)) {
    return raster;
  }
  steps.push(step('crop', raster, bounds));
  return cropRaster(raster, bounds);
}

function keptLines(length: number, start: number, end: number, keep: number | undefined): number[] {
  const span = length - start - end;
  const kept = keep === undefined ? span : Math.min(keep, span);
  return [
    ...Array.from({ length: start }, (_, index) => index),
    ...Array.from({ length: kept }, (_, index) => start + index),
    ...Array.from({ length: end }, (_, index) => length - end + index),
  ];
}

function step(name: NormalizeStep['step'], from: Raster, to: Raster | Rect): NormalizeStep {
  return {
    step: name,
    from: { width: from.width, height: from.height },
    to: { width: to.width, height: to.height },
  };
}
