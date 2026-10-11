import {
  contentBounds,
  defaultMatchOptions,
  detectStretchSpan,
  firstMismatch,
  lineDistance,
  linesMatch,
  type Axis,
  type AxisSpan,
  type MatchOptions,
} from './detect.js';
import { alphaAt, pixelOffset, type Raster, type Rect } from './raster.js';
import {
  insetsProblem,
  insetsToScale9Borders,
  isThreeSlice,
  type Scale9Borders,
  type SliceInsets,
  type SliceMode,
} from './slices.js';

export type Severity = 'error' | 'warning' | 'info';

export interface Finding {
  readonly code: string;
  readonly severity: Severity;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface TileAxes {
  readonly x: boolean;
  readonly y: boolean;
}

export interface InspectOptions extends MatchOptions {
  /** Caller-supplied insets; omitted means detect them. */
  readonly insets?: SliceInsets;
  readonly mode: 'auto' | SliceMode;
  readonly tile: TileAxes;
}

export interface InspectReport {
  readonly ok: boolean;
  readonly width: number;
  readonly height: number;
  readonly mode: SliceMode;
  readonly insetsSource: 'detected' | 'given';
  readonly insets: SliceInsets;
  readonly scale9Borders: Scale9Borders;
  readonly minSize: { readonly width: number; readonly height: number };
  readonly contentBounds: Rect | null;
  readonly findings: readonly Finding[];
}

export const defaultInspectOptions: InspectOptions = {
  ...defaultMatchOptions,
  mode: 'auto',
  tile: { x: false, y: false },
};

const spillDominance = 64;
const spillRatio = 0.01;

/**
 * Detects or verifies a slice layout and reports what would break when the
 * image is stretched.
 */
export function inspectRaster(
  raster: Raster,
  options: InspectOptions = defaultInspectOptions,
): InspectReport {
  const findings: Finding[] = [];
  const bounds = contentBounds(raster);
  const full: Rect = { x: 0, y: 0, width: raster.width, height: raster.height };

  if (bounds === undefined) {
    findings.push({
      code: 'image.empty',
      severity: 'error',
      message: 'Every pixel is fully transparent.',
    });
  } else {
    findings.push(...marginFindings(raster, bounds));
    findings.push(...chromaSpillFindings(raster));
  }

  const resolved =
    options.insets === undefined
      ? detectLayout(raster, bounds ?? full, options, findings)
      : verifyLayout(raster, options.insets, options, findings);

  const { insets, mode } = resolved;
  findings.push(...symmetryFindings(insets));
  for (const axis of ['x', 'y'] as const) {
    if (options.tile[axis] && !(axis === 'y' && mode === 'three')) {
      findings.push(...seamFindings(raster, axis, spanOf(raster, insets, axis), options));
    }
  }

  return {
    ok: !findings.some((finding) => finding.severity === 'error'),
    width: raster.width,
    height: raster.height,
    mode,
    insetsSource: options.insets === undefined ? 'detected' : 'given',
    insets,
    scale9Borders: insetsToScale9Borders(insets, raster.width, raster.height),
    minSize: {
      width: insets.left + insets.right,
      height: mode === 'three' ? raster.height : insets.top + insets.bottom,
    },
    contentBounds: bounds ?? null,
    findings,
  };
}

export interface Layout {
  readonly insets: SliceInsets;
  readonly mode: SliceMode;
}

/**
 * @evidence docs/spec.md#stretch-detection Detects each axis inside the content bounds and falls back to the center pixel with a warning.
 * @evidenceReview docs/spec.md#stretch-detection Read the section against this function and ran detectsPanelInsets green with pnpm test.
 * @evidence docs/spec.md#three-slice Turns an image without a vertical stretch span into a three-slice in automatic mode.
 * @evidenceReview docs/spec.md#three-slice Read the section against this function and ran treatsShadedBarsAsThreeSlices green with pnpm test.
 */
export function detectLayout(
  raster: Raster,
  bounds: Rect,
  options: InspectOptions,
  findings: Finding[],
): Layout {
  const spanX = detectStretchSpan(raster, 'x', bounds, options);
  const spanY = options.mode === 'three'
    ? undefined
    : detectStretchSpan(raster, 'y', bounds, options);

  if (spanX === undefined) {
    findings.push({
      code: 'stretch.x.none',
      severity: 'warning',
      message:
        'No two adjacent columns match, so horizontal stretching will smear detail. ' +
        'Using the center column; regenerate with flat edges or give insets with --tile x.',
    });
  }
  const x = spanX ?? centerSpan(bounds.x, bounds.width);
  const horizontal = { left: x.start, right: raster.width - x.end };

  if (options.mode === 'three' || (spanY === undefined && options.mode === 'auto')) {
    if (options.mode === 'auto') {
      findings.push({
        code: 'three-slice.auto',
        severity: 'info',
        message: 'No two adjacent rows match, so the layout is a three-slice with a fixed height.',
      });
    }
    return { insets: { ...horizontal, top: 0, bottom: 0 }, mode: 'three' };
  }

  if (spanY === undefined) {
    findings.push({
      code: 'stretch.y.none',
      severity: 'warning',
      message:
        'No two adjacent rows match, so vertical stretching will smear detail. Using the center row.',
    });
  }
  const y = spanY ?? centerSpan(bounds.y, bounds.height);
  const insets = { ...horizontal, top: y.start, bottom: raster.height - y.end };
  return { insets, mode: isThreeSlice(insets) ? 'three' : 'nine' };
}

/**
 * @evidence docs/spec.md#slice-insets Rejects caller insets that leave no stretch span.
 * @evidenceReview docs/spec.md#slice-insets Read the section against this function and ran rejectsInsetsWithoutAStretchSpan green with pnpm test.
 * @evidence docs/spec.md#stretch-uniformity Reports the first mismatching pair in each caller-given stretch span unless the axis tiles.
 * @evidenceReview docs/spec.md#stretch-uniformity Read the section against this function and ran rejectsGivenInsetsThatStretchDetail green with pnpm test.
 * @evidence docs/spec.md#three-slice Forces zero top and bottom insets in three-slice mode.
 * @evidenceReview docs/spec.md#three-slice Read the section against this function and ran treatsShadedBarsAsThreeSlices green with pnpm test.
 */
export function verifyLayout(
  raster: Raster,
  given: SliceInsets,
  options: InspectOptions,
  findings: Finding[],
): Layout {
  const insets = options.mode === 'three' ? { ...given, top: 0, bottom: 0 } : given;
  const mode: SliceMode = options.mode === 'three' || isThreeSlice(insets) ? 'three' : 'nine';
  const problem = insetsProblem(insets, raster.width, raster.height);
  if (problem !== undefined) {
    findings.push({ code: 'insets.invalid', severity: 'error', message: problem });
    return { insets, mode };
  }

  const full: Rect = { x: 0, y: 0, width: raster.width, height: raster.height };
  for (const axis of ['x', 'y'] as const) {
    if (options.tile[axis] || (axis === 'y' && mode === 'three')) {
      continue;
    }
    const mismatch = firstMismatch(raster, axis, spanOf(raster, insets, axis), full, options);
    if (mismatch !== undefined) {
      const line = axis === 'x' ? 'columns' : 'rows';
      findings.push({
        code: `stretch.${axis}.nonuniform`,
        severity: 'error',
        message: `${line} ${mismatch} and ${mismatch + 1} differ inside the stretch span, so stretching changes the art.`,
        details: { axis, pair: [mismatch, mismatch + 1] },
      });
    }
  }
  return { insets, mode };
}

/**
 * @evidence docs/spec.md#tiling-seams Requires a repeating span to hold whole periods and a non-repeating span to wrap no harder than its largest step.
 * @evidenceReview docs/spec.md#tiling-seams Read the section against this function and ran checksTilingSeams green with pnpm test.
 */
export function seamFindings(
  raster: Raster,
  axis: Axis,
  span: AxisSpan,
  options: MatchOptions,
): Finding[] {
  const length = span.end - span.start;
  if (length < 2) {
    return [];
  }
  const full: Rect = { x: 0, y: 0, width: raster.width, height: raster.height };
  const period = repeatPeriod(raster, axis, span, full, options);
  if (period !== undefined) {
    if (length % period === 0) {
      return [];
    }
    return [
      {
        code: `tile.${axis}.seam`,
        severity: 'warning',
        message: `The tiled span is ${length} px but its pattern repeats every ${period} px, so tiles cut the pattern.`,
        details: {
          axis,
          span,
          period,
          nearestLengths: [length - (length % period), length - (length % period) + period],
        },
      },
    ];
  }
  const wrap = lineDistance(raster, axis, span.end - 1, span.start, full);
  let largestStep = 0;
  for (let index = span.start; index < span.end - 1; index += 1) {
    largestStep = Math.max(largestStep, lineDistance(raster, axis, index, index + 1, full));
  }
  if (wrap <= Math.max(options.tolerance, largestStep)) {
    return [];
  }
  return [
    {
      code: `tile.${axis}.seam`,
      severity: 'warning',
      message: `The tiled span jumps by ${Math.round(wrap)} where it wraps, more than any step inside it (${Math.round(largestStep)}), so tiles show a seam.`,
      details: { axis, span, wrap, largestStep },
    },
  ];
}

/** Smallest period, at most half the span, that every line in it repeats with. */
function repeatPeriod(
  raster: Raster,
  axis: Axis,
  span: AxisSpan,
  bounds: Rect,
  options: MatchOptions,
): number | undefined {
  const length = span.end - span.start;
  for (let period = 1; period * 2 <= length; period += 1) {
    let repeats = true;
    for (let index = span.start; index + period < span.end && repeats; index += 1) {
      repeats = linesMatch(raster, axis, index, index + period, bounds, options);
    }
    if (repeats) {
      return period;
    }
  }
  return undefined;
}

/**
 * @evidence docs/spec.md#transparent-margins Warns about border margins with the content bounds.
 * @evidenceReview docs/spec.md#transparent-margins Read the section against this function and ran warnsAboutTransparentMargins green with pnpm test.
 */
export function marginFindings(raster: Raster, bounds: Rect): Finding[] {
  const margins = {
    left: bounds.x,
    right: raster.width - bounds.x - bounds.width,
    top: bounds.y,
    bottom: raster.height - bounds.y - bounds.height,
  };
  if (Object.values(margins).every((value) => value === 0)) {
    return [];
  }
  return [
    {
      code: 'margin.transparent',
      severity: 'warning',
      message:
        'Fully transparent margins become part of the corners. Crop them unless the margin is intended spacing.',
      details: { margins, contentBounds: bounds },
    },
  ];
}

/**
 * @evidence docs/spec.md#chroma-spill Counts green or magenta dominated alpha-edge pixels against the 1% threshold.
 * @evidenceReview docs/spec.md#chroma-spill Read the section against this function and ran flagsChromaSpill green with pnpm test.
 */
export function chromaSpillFindings(raster: Raster): Finding[] {
  let edgePixels = 0;
  let green = 0;
  let magenta = 0;
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const alpha = alphaAt(raster, x, y);
      if (alpha === 0 || (alpha === 255 && !touchesTransparency(raster, x, y))) {
        continue;
      }
      edgePixels += 1;
      const offset = pixelOffset(raster, x, y);
      const r = raster.data[offset] ?? 0;
      const g = raster.data[offset + 1] ?? 0;
      const b = raster.data[offset + 2] ?? 0;
      if (g - Math.max(r, b) > spillDominance) {
        green += 1;
      } else if (Math.min(r, b) - g > spillDominance) {
        magenta += 1;
      }
    }
  }
  const spill = green + magenta;
  if (edgePixels === 0 || spill / edgePixels <= spillRatio) {
    return [];
  }
  return [
    {
      code: 'alpha.chroma-spill',
      severity: 'warning',
      message: `${spill} of ${edgePixels} alpha-edge pixels are tinted by the ${green >= magenta ? 'green' : 'magenta'} key. Despill or re-key before slicing.`,
      details: { edgePixels, green, magenta },
    },
  ];
}

function touchesTransparency(raster: Raster, x: number, y: number): boolean {
  for (const [dx, dy] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < raster.width && ny < raster.height && alphaAt(raster, nx, ny) === 0) {
      return true;
    }
  }
  return false;
}

function symmetryFindings(insets: SliceInsets): Finding[] {
  const horizontal = Math.abs(insets.left - insets.right);
  const vertical = Math.abs(insets.top - insets.bottom);
  if (horizontal <= 2 && vertical <= 2) {
    return [];
  }
  return [
    {
      code: 'insets.asymmetric',
      severity: 'info',
      message:
        'Opposite insets differ by more than 2 px. Generated art is often slightly off-center; consider equal insets.',
      details: { horizontal, vertical },
    },
  ];
}

export function spanOf(raster: Raster, insets: SliceInsets, axis: Axis): AxisSpan {
  return axis === 'x'
    ? { start: insets.left, end: raster.width - insets.right }
    : { start: insets.top, end: raster.height - insets.bottom };
}

function centerSpan(start: number, length: number): AxisSpan {
  const center = start + Math.floor((length - 1) / 2);
  return { start: center, end: center + 1 };
}
