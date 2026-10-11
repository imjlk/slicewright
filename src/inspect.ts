import {
  contentBounds,
  defaultMatchOptions,
  detectRepeatSpan,
  detectStretchRuns,
  detectStretchSpan,
  estimateNoise,
  firstMismatch,
  lineDistance,
  linesMatch,
  type Axis,
  type AxisSpan,
  type MatchOptions,
} from './detect.js';
import {
  axisFromSpans,
  flexibleSegments,
  layoutFromInsets,
  minimumLayoutSize,
  type AxisLayout,
  type SliceLayout,
} from './layout.js';
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
  readonly mode: 'auto' | 'nine' | 'three' | 'three-vertical';
  readonly tile: TileAxes;
  /** `multi` keeps every long stretchable run on an axis instead of only the longest. */
  readonly regions?: 'single' | 'multi';
  /** `auto` raises the tolerance to the measured noise floor of generated art. */
  readonly noise: 'auto' | 'off';
}

/** Matching settings per axis; noise is measured separately along each. */
export interface AxisMatching {
  readonly x: MatchOptions;
  readonly y: MatchOptions;
}

export interface InspectReport {
  readonly ok: boolean;
  readonly width: number;
  readonly height: number;
  readonly mode: SliceMode;
  readonly insetsSource: 'detected' | 'given';
  /** Insets of the layout; for a multi-region layout, its outermost flexible lines. */
  readonly insets: SliceInsets;
  readonly scale9Borders: Scale9Borders;
  /** The engine-neutral layout every renderer and target consumes. */
  readonly layout: SliceLayout;
  readonly minSize: { readonly width: number; readonly height: number };
  readonly contentBounds: Rect | null;
  /** Axes that tile, as given or detected from repeating edges. */
  readonly tile: TileAxes;
  /** Tolerance and outlier ratio actually used per axis, after noise handling. */
  readonly matching: AxisMatching;
  readonly findings: readonly Finding[];
}

export const defaultInspectOptions: InspectOptions = {
  ...defaultMatchOptions,
  mode: 'auto',
  tile: { x: false, y: false },
  noise: 'auto',
};

/** Effective tolerance is this many times the measured noise floor. */
const noiseFactor = 3;
/** Noise handling never raises the tolerance above this. */
const maximumNoiseTolerance = 24;
/** A noise floor above this is texture or a defect rather than noise. */
const busyNoise = 8;
/** Outlier ratio used once noise is measured, so isolated noisy pixels do not split runs. */
const noisyOutlierRatio = 0.02;

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
  if (options.insets !== undefined && options.regions === 'multi') {
    throw new RangeError(
      'Multiple regions are detected, not given: drop the insets or use single regions.',
    );
  }
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
    findings.push(...interiorAlphaFindings(raster, bounds));
  }

  const matching = noiseAdjusted(raster, bounds, options, findings);
  const resolved =
    options.insets === undefined
      ? detectLayout(raster, bounds ?? full, options, matching, findings)
      : verifyLayout(raster, options.insets, options, matching, findings);

  const { insets, mode, tile, layout } = resolved;
  findings.push(...symmetryFindings(insets));
  for (const axis of ['x', 'y'] as const) {
    // Only an axis with exactly one tiled span has a seam to check.
    if (tile[axis] && flexibleSegments(layout[axis]).length === 1) {
      findings.push(...seamFindings(raster, axis, spanOf(raster, insets, axis), matching[axis]));
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
    layout,
    minSize: minimumLayoutSize(layout),
    contentBounds: bounds ?? null,
    tile,
    matching,
    findings,
  };
}

/**
 * Raises each axis's tolerance and outlier ratio to that axis's noise floor
 * when noise handling is automatic and the image is not clean.
 *
 * @evidence docs/spec.md#stretch-detection Applies three times each axis's noise floor up to 24 and a 2% outlier ratio, warns when both axes are busy, and records the change.
 * @evidenceReview docs/spec.md#stretch-detection #ff483ae Checked this code against the section line by line and ran toleratesGeneratedNoise green with pnpm test.
 */
export function noiseAdjusted(
  raster: Raster,
  bounds: Rect | undefined,
  options: InspectOptions,
  findings: Finding[],
): AxisMatching {
  const exact: MatchOptions = { tolerance: options.tolerance, outlierRatio: options.outlierRatio };
  if (options.noise === 'off' || bounds === undefined) {
    return { x: exact, y: exact };
  }
  const noise = { x: estimateNoise(raster, bounds, 'x'), y: estimateNoise(raster, bounds, 'y') };
  const adjust = (floor: number): MatchOptions =>
    floor === 0
      ? exact
      : {
          tolerance: Math.max(
            options.tolerance,
            Math.min(maximumNoiseTolerance, Math.ceil(floor * noiseFactor)),
          ),
          outlierRatio: Math.max(options.outlierRatio, noisyOutlierRatio),
        };
  const matching = { x: adjust(noise.x), y: adjust(noise.y) };
  if (noise.x === 0 && noise.y === 0) {
    return matching;
  }
  if (noise.x > busyNoise && noise.y > busyNoise) {
    findings.push({
      code: 'noise.high',
      severity: 'warning',
      message: `The interior is busy along both axes (noise floors ${noise.x.toFixed(1)} and ${noise.y.toFixed(1)}), so stretching smears it and tolerance stops at ${maximumNoiseTolerance}. Use a flatter fill, tile it, or check the alpha for holes.`,
      details: { noise },
    });
  }
  findings.push({
    code: 'noise.tolerance',
    severity: 'info',
    message: `Measured noise floors x ${noise.x.toFixed(1)} and y ${noise.y.toFixed(1)}; lines match within x ${matching.x.tolerance} and y ${matching.y.tolerance}. Pass --noise off for exact matching.`,
    details: { noise, x: matching.x, y: matching.y },
  });
  return matching;
}

export interface Layout {
  readonly insets: SliceInsets;
  readonly mode: SliceMode;
  readonly tile: TileAxes;
  readonly layout: SliceLayout;
}

/** A stretch span shorter than this fraction of the content is too short to trust. */
const shortSpanRatio = 0.1;

type AxisPick =
  | { readonly span: AxisSpan; readonly tile: boolean }
  | { readonly span: undefined; readonly reason: 'none' | 'short' };

/**
 * Picks one axis's stretch span: the longest uniform run when it is long
 * enough, else the longest repeating span, which then tiles.
 *
 * @evidence docs/spec.md#repeating-edges Falls back from a short uniform run to a repeating span and marks the axis as tiled.
 * @evidenceReview docs/spec.md#repeating-edges #795d113 Checked this code against the section line by line and ran tilesRepeatingEdges green with pnpm test.
 */
export function pickAxisSpan(
  raster: Raster,
  axis: Axis,
  bounds: Rect,
  matching: MatchOptions,
  findings: Finding[],
): AxisPick {
  const length = axis === 'x' ? bounds.width : bounds.height;
  const minimum = Math.max(2, Math.ceil(length * shortSpanRatio));
  const uniform = detectStretchSpan(raster, axis, bounds, matching);
  if (uniform !== undefined && uniform.end - uniform.start >= minimum) {
    return { span: uniform, tile: false };
  }
  const repeat = detectRepeatSpan(raster, axis, bounds, matching);
  if (repeat !== undefined && repeat.span.end - repeat.span.start >= minimum) {
    findings.push({
      code: `tile.${axis}.auto`,
      severity: 'info',
      message: `The ${axis === 'x' ? 'horizontal' : 'vertical'} edges repeat every ${repeat.period} px, so this axis tiles a span of whole periods. Create the NineSlice with tile${axis.toUpperCase()} enabled.`,
      details: { axis, period: repeat.period, span: repeat.span },
    });
    return { span: repeat.span, tile: true };
  }
  return { span: undefined, reason: uniform === undefined ? 'none' : 'short' };
}

/**
 * @evidence docs/spec.md#stretch-detection Detects each axis inside the content bounds and falls back to the center pixel with a warning when no span is found or the span is too short.
 * @evidenceReview docs/spec.md#stretch-detection #ff483ae Checked this code against the section line by line and ran detectsPanelInsets green with pnpm test.
 * @evidence docs/spec.md#three-slice Turns an image without a vertical stretch span into a three-slice in automatic mode.
 * @evidenceReview docs/spec.md#three-slice #08c1617 Checked this code against the section line by line and ran treatsShadedBarsAsThreeSlices green with pnpm test.
 * @evidence docs/spec.md#vertical-three-slice Keeps the width when columns never match but rows do, or when the mode asks for it.
 * @evidenceReview docs/spec.md#vertical-three-slice #072e9af Checked this code against the section line by line and ran detectsVerticalThreeSlices green with pnpm test.
 * @evidence docs/spec.md#multiple-stretch-regions Builds a multi-region layout when asked and an axis has more than one long run.
 * @evidenceReview docs/spec.md#multiple-stretch-regions #f4dd501 Checked this code against the section line by line and ran detectsMultipleRegions green with pnpm test.
 */
export function detectLayout(
  raster: Raster,
  bounds: Rect,
  options: InspectOptions,
  matching: AxisMatching,
  findings: Finding[],
): Layout {
  const fallback = (axis: Axis, reason: 'none' | 'short'): AxisSpan => {
    const lines = axis === 'x' ? 'columns' : 'rows';
    findings.push({
      code: `stretch.${axis}.${reason}`,
      severity: 'warning',
      message:
        reason === 'none'
          ? `No two adjacent ${lines} match, so stretching along ${axis} will smear detail. Using the center line; regenerate with plain edges, or give insets.`
          : `The longest run of matching ${lines} is under ${shortSpanRatio * 100}% of the content and nothing repeats, so the edges carry non-repeating detail. Using the center line; regenerate with plain edges, or give insets after checking the preview.`,
    });
    return axis === 'x' ? centerSpan(bounds.x, bounds.width) : centerSpan(bounds.y, bounds.height);
  };
  const tiles = (pick: AxisPick | undefined): boolean => pick?.span !== undefined && pick.tile;
  const finish = (insets: SliceInsets, mode: SliceMode, tile: TileAxes): Layout => {
    const shape = mode === 'three' || mode === 'three-vertical' ? mode : 'nine';
    const single: Layout = {
      insets,
      mode,
      tile,
      layout: layoutFromInsets(insets, raster.width, raster.height, { shape, tile }),
    };
    // Multiple regions refine whatever single layout was found, fixed axes included.
    return options.regions === 'multi'
      ? (multiRegionLayout(raster, bounds, matching, single, findings) ?? single)
      : single;
  };

  const pickX =
    options.mode === 'three-vertical'
      ? undefined
      : pickAxisSpan(raster, 'x', bounds, matching.x, findings);
  const pickY =
    options.mode === 'three' ? undefined : pickAxisSpan(raster, 'y', bounds, matching.y, findings);

  const verticalThree =
    options.mode === 'three-vertical' ||
    (options.mode === 'auto' &&
      pickX?.span === undefined &&
      pickX?.reason === 'none' &&
      pickY?.span !== undefined);
  if (verticalThree) {
    if (options.mode === 'auto') {
      findings.push({
        code: 'three-slice.vertical.auto',
        severity: 'info',
        message: 'No two adjacent columns match but rows do, so the layout keeps its width and stretches vertically.',
      });
    }
    const y = pickY?.span ?? fallback('y', pickY?.span === undefined ? (pickY?.reason ?? 'none') : 'none');
    return finish(
      { left: 0, right: 0, top: y.start, bottom: raster.height - y.end },
      'three-vertical',
      { x: false, y: options.tile.y || tiles(pickY) },
    );
  }

  const x = pickX?.span ?? fallback('x', pickX?.span === undefined ? (pickX?.reason ?? 'none') : 'none');
  const horizontal = { left: x.start, right: raster.width - x.end };
  const tileX = options.tile.x || tiles(pickX);

  const horizontalThree =
    options.mode === 'three' ||
    (options.mode === 'auto' && pickY?.span === undefined && pickY?.reason === 'none');
  if (horizontalThree) {
    if (options.mode === 'auto') {
      findings.push({
        code: 'three-slice.auto',
        severity: 'info',
        message: 'No two adjacent rows match, so the layout is a three-slice with a fixed height.',
      });
    }
    return finish({ ...horizontal, top: 0, bottom: 0 }, 'three', { x: tileX, y: false });
  }

  const y = pickY?.span ?? fallback('y', pickY?.span === undefined ? (pickY?.reason ?? 'none') : 'none');
  const insets = { ...horizontal, top: y.start, bottom: raster.height - y.end };
  const tile = { x: tileX, y: options.tile.y || tiles(pickY) };
  return finish(insets, isThreeSlice(insets) ? 'three' : 'nine', tile);
}

/**
 * Keeps every long uniform run on an axis as its own stretch segment. Used
 * only when an axis has more than one such run and does not tile.
 *
 * @evidence docs/spec.md#multiple-stretch-regions Keeps every long uniform run as a stretch segment, leaves tiled axes single, and records the counts.
 * @evidenceReview docs/spec.md#multiple-stretch-regions #f4dd501 Checked this code against the section line by line and ran detectsMultipleRegions green with pnpm test.
 */
export function multiRegionLayout(
  raster: Raster,
  bounds: Rect,
  matching: AxisMatching,
  base: Layout,
  findings: Finding[],
): Layout | undefined {
  const runsFor = (axis: Axis): AxisSpan[] => {
    // A tiled axis and an axis the base layout keeps fixed are never split.
    if (base.tile[axis] || flexibleSegments(base.layout[axis]).length === 0) {
      return [];
    }
    const length = axis === 'x' ? bounds.width : bounds.height;
    const minimum = Math.max(2, Math.ceil(length * shortSpanRatio));
    return detectStretchRuns(raster, axis, bounds, matching[axis], minimum);
  };
  const runsX = runsFor('x');
  const runsY = runsFor('y');
  if (runsX.length < 2 && runsY.length < 2) {
    return undefined;
  }
  const axisFor = (axis: Axis, runs: AxisSpan[]): AxisLayout =>
    runs.length < 2
      ? base.layout[axis]
      : axisFromSpans(
          axis === 'x' ? raster.width : raster.height,
          runs.map((run) => ({ ...run, kind: 'stretch' as const })),
        );
  const layout: SliceLayout = { x: axisFor('x', runsX), y: axisFor('y', runsY) };
  const envelope = (axis: AxisLayout): [number, number] => {
    const flexible = flexibleSegments(axis);
    return flexible.length === 0
      ? [0, 0]
      : [flexible[0]?.start ?? 0, axis.length - (flexible.at(-1)?.end ?? axis.length)];
  };
  const [left, right] = envelope(layout.x);
  const [top, bottom] = envelope(layout.y);
  const regions = {
    x: flexibleSegments(layout.x).length,
    y: flexibleSegments(layout.y).length,
  };
  findings.push({
    code: 'regions.multi',
    severity: 'info',
    message: `The layout keeps ${regions.x} horizontal and ${regions.y} vertical stretch regions; no current target can export more than one region per axis.`,
    details: regions,
  });
  return { insets: { left, right, top, bottom }, mode: 'multi', tile: base.tile, layout };
}

/**
 * @evidence docs/spec.md#slice-insets Rejects caller insets that leave no stretch span.
 * @evidenceReview docs/spec.md#slice-insets #705f0b4 Checked this code against the section line by line and ran rejectsInsetsWithoutAStretchSpan green with pnpm test.
 * @evidence docs/spec.md#stretch-uniformity Reports the first mismatching pair in each caller-given stretch span unless the axis tiles.
 * @evidenceReview docs/spec.md#stretch-uniformity #695468c Checked this code against the section line by line and ran rejectsGivenInsetsThatStretchDetail green with pnpm test.
 * @evidence docs/spec.md#three-slice Forces zero top and bottom insets in three-slice mode.
 * @evidenceReview docs/spec.md#three-slice #08c1617 Checked this code against the section line by line and ran treatsShadedBarsAsThreeSlices green with pnpm test.
 * @evidence docs/spec.md#vertical-three-slice Forces zero left and right insets and skips the column check in vertical three-slice mode.
 * @evidenceReview docs/spec.md#vertical-three-slice #072e9af Checked this code against the section line by line and ran detectsVerticalThreeSlices green with pnpm test.
 */
export function verifyLayout(
  raster: Raster,
  given: SliceInsets,
  options: InspectOptions,
  matching: AxisMatching,
  findings: Finding[],
): Layout {
  const insets =
    options.mode === 'three'
      ? { ...given, top: 0, bottom: 0 }
      : options.mode === 'three-vertical'
        ? { ...given, left: 0, right: 0 }
        : given;
  const mode: 'nine' | 'three' | 'three-vertical' =
    options.mode === 'three-vertical'
      ? 'three-vertical'
      : options.mode === 'three' || isThreeSlice(insets)
        ? 'three'
        : 'nine';
  const tile = {
    x: options.tile.x && mode !== 'three-vertical',
    y: options.tile.y && mode !== 'three',
  };
  const problem = insetsProblem(insets, raster.width, raster.height);
  if (problem !== undefined) {
    findings.push({ code: 'insets.invalid', severity: 'error', message: problem });
    // Invalid insets cannot form spans; report on a layout that resizes nothing.
    const fixed = { x: axisFromSpans(raster.width, []), y: axisFromSpans(raster.height, []) };
    return { insets, mode, tile, layout: fixed };
  }
  const layout = layoutFromInsets(insets, raster.width, raster.height, {
    shape: mode,
    tile,
  });

  const full: Rect = { x: 0, y: 0, width: raster.width, height: raster.height };
  for (const axis of ['x', 'y'] as const) {
    if (tile[axis] || (axis === 'y' && mode === 'three') || (axis === 'x' && mode === 'three-vertical')) {
      continue;
    }
    const mismatch = firstMismatch(
      raster,
      axis,
      spanOf(raster, insets, axis),
      full,
      matching[axis],
    );
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
  return { insets, mode, tile, layout };
}

/**
 * @evidence docs/spec.md#tiling-seams Requires a repeating span to hold whole periods and a non-repeating span to wrap no harder than its largest step.
 * @evidenceReview docs/spec.md#tiling-seams #e6197a2 Checked this code against the section line by line and ran checksTilingSeams green with pnpm test.
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
  const periods = repeatPeriods(raster, axis, span, full, options);
  if (periods.length > 0) {
    if (periods.some((period) => length % period === 0)) {
      return [];
    }
    const period = periods[0] ?? 1;
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

/** Periods, at most half the span, that every line in it repeats with, shortest first. */
function repeatPeriods(
  raster: Raster,
  axis: Axis,
  span: AxisSpan,
  bounds: Rect,
  options: MatchOptions,
): number[] {
  const length = span.end - span.start;
  const periods: number[] = [];
  for (let period = 1; period * 2 <= length; period += 1) {
    let repeats = true;
    for (let index = span.start; index + period < span.end && repeats; index += 1) {
      repeats = linesMatch(raster, axis, index, index + period, bounds, options);
    }
    if (repeats) {
      periods.push(period);
    }
  }
  return periods;
}

/**
 * @evidence docs/spec.md#transparent-margins Warns about border margins with the content bounds.
 * @evidenceReview docs/spec.md#transparent-margins #5bcc022 Checked this code against the section line by line and ran warnsAboutTransparentMargins green with pnpm test.
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
 * @evidenceReview docs/spec.md#chroma-spill #420e523 Checked this code against the section line by line and ran flagsChromaSpill green with pnpm test.
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

/** Share of partly transparent pixels in the interior above which alpha is suspect. */
const interiorAlphaRatio = 0.05;

/**
 * Warns when the central half of the content is partly transparent, which a
 * generator faking alpha leaves as blotchy holes.
 *
 * @evidence docs/spec.md#interior-alpha Counts partly transparent pixels in the central half of the content against the 5% threshold.
 * @evidenceReview docs/spec.md#interior-alpha #d87616b Checked the 1-249 alpha band, the central half, and the 5% threshold against the section and ran flagsInteriorAlphaHoles green with pnpm test.
 */
export function interiorAlphaFindings(raster: Raster, bounds: Rect): Finding[] {
  const x0 = bounds.x + Math.floor(bounds.width / 4);
  const x1 = bounds.x + Math.ceil((bounds.width * 3) / 4);
  const y0 = bounds.y + Math.floor(bounds.height / 4);
  const y1 = bounds.y + Math.ceil((bounds.height * 3) / 4);
  let partial = 0;
  let total = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const alpha = alphaAt(raster, x, y);
      total += 1;
      if (alpha > 0 && alpha < 250) {
        partial += 1;
      }
    }
  }
  if (total === 0 || partial / total <= interiorAlphaRatio) {
    return [];
  }
  return [
    {
      code: 'alpha.interior',
      severity: 'warning',
      message: `${Math.round((partial / total) * 100)}% of the interior is partly transparent. A deliberate glass fill is fine, but generators that fake alpha leave holes like this; check the preview, or regenerate on a chroma key and run slicewright key.`,
      details: { partial, total },
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
