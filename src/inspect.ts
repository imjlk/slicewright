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
  contentLimits,
  flexibleSegments,
  layoutFromInsets,
  layoutShape,
  minimumLayoutSize,
  type AxisLayout,
  type SliceLayout,
} from './layout.js';
import { detectContentPadding, paddingProblem } from './padding.js';
import { alphaAt, pixelOffset, type Raster, type Rect } from './raster.js';
import {
  insetsProblem,
  insetsToScale9Borders,
  isThreeSlice,
  type Scale9Borders,
  type SliceInsets,
  type SliceMode,
} from './slices.js';
import { detectPixelGrid, pixelGridFindings } from './pixel-grid.js';

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
  /** Caller-supplied content padding; omitted means detect it. */
  readonly contentPadding?: SliceInsets;
  /** Look for the grid of upscaled pixel art. */
  readonly pixelArt?: boolean;
  /** Known pixel-art scale; places the grid instead of searching and implies `pixelArt`. */
  readonly pixelScale?: number;
  /**
   * Caller-supplied layout, such as the one normalize reports for a
   * multi-region rebuild; verified instead of detected.
   */
  readonly layout?: SliceLayout;
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
  /** `layout` when a whole layout was given, `given` for given insets. */
  readonly insetsSource: 'detected' | 'given' | 'layout';
  /** Insets of the layout; for a multi-region layout, its outermost flexible lines. */
  readonly insets: SliceInsets;
  readonly scale9Borders: Scale9Borders;
  /** The engine-neutral layout every renderer and target consumes. */
  readonly layout: SliceLayout;
  /** Where content such as text sits inside the frame; null for an empty image. */
  readonly contentPadding: SliceInsets | null;
  readonly contentPaddingSource: 'detected' | 'given';
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
/** How many times the art's own share of a key color the edge must reach to count as spill. */
const spillContrast = 3;
/** Alpha at or above this is opaque: generators often draw solid faces at 240 to 254. */
const opaqueAlpha = 224;
/** How far from a transparent pixel a key-colored fringe reaches. */
const spillReach = 2;

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
    if (options.pixelArt === true || options.pixelScale !== undefined) {
      const given = options.pixelScale === undefined ? {} : { scale: options.pixelScale };
      findings.push(...pixelGridFindings(detectPixelGrid(raster, bounds, given)));
    }
  }

  if (options.layout !== undefined && (options.insets !== undefined || options.regions === 'multi')) {
    throw new RangeError(
      'A given layout replaces insets and region detection: give only the layout.',
    );
  }
  const matching = noiseAdjusted(raster, bounds, options, findings);
  const resolved =
    options.layout !== undefined
      ? verifyGivenLayout(raster, options.layout, matching, findings)
      : options.insets === undefined
        ? detectLayout(raster, bounds ?? full, options, matching, findings)
        : verifyLayout(raster, options.insets, options, matching, findings);

  const { insets, mode, tile, layout } = resolved;
  findings.push(...symmetryFindings(insets));
  findings.push(...largeInsetFindings(layout));
  for (const axis of ['x', 'y'] as const) {
    // Only an axis with exactly one tiled span has a seam to check.
    if (tile[axis] && flexibleSegments(layout[axis]).length === 1) {
      findings.push(...seamFindings(raster, axis, spanOf(raster, insets, axis), matching[axis]));
    }
  }

  // A given layout's own content padding counts as given padding, checked the same way.
  const givenContent = options.contentPadding ?? options.layout?.content;
  const paddingOptions =
    givenContent === undefined ? options : { ...options, contentPadding: givenContent };
  const contentPadding = resolveContentPadding(
    raster,
    bounds,
    paddingOptions,
    matching,
    layout,
    findings,
  );
  // Padding that failed validation is reported but never enters the layout, so
  // exports carry no padding rather than one that would scale with the art.
  const paddingRejected = findings.some((finding) => finding.code === 'padding.invalid');
  const finalLayout: SliceLayout =
    contentPadding === null || paddingRejected ? layout : { ...layout, content: contentPadding };

  return {
    ok: !findings.some((finding) => finding.severity === 'error'),
    width: raster.width,
    height: raster.height,
    mode,
    insetsSource:
      options.layout !== undefined ? 'layout' : options.insets === undefined ? 'detected' : 'given',
    insets,
    scale9Borders: insetsToScale9Borders(insets, raster.width, raster.height),
    layout: finalLayout,
    contentPadding,
    contentPaddingSource: givenContent === undefined ? 'detected' : 'given',
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

/**
 * Given content padding is validated; otherwise it is detected from the
 * content and clamped to the fixed segments at each edge of a resizable axis,
 * so it never changes when the art resizes.
 *
 * @evidence docs/spec.md#content-padding Validates given padding, detects it otherwise, and keeps it within the fixed segments at each edge.
 * @evidenceReview docs/spec.md#content-padding #3fc5743 Checked this code against the section line by line and ran detectsContentPadding green with pnpm test.
 */
export function resolveContentPadding(
  raster: Raster,
  bounds: Rect | undefined,
  options: InspectOptions,
  matching: AxisMatching,
  layout: SliceLayout,
  findings: Finding[],
): SliceInsets | null {
  const limits = contentLimits(layout);
  const sides = ['left', 'right', 'top', 'bottom'] as const;
  if (options.contentPadding !== undefined) {
    const given = options.contentPadding;
    const problem =
      paddingProblem(given, raster.width, raster.height) ??
      sides
        .filter((side) => given[side] > limits[side])
        .map(
          (side) =>
            `${side} padding ${given[side]} reaches past the fixed ${limits[side]} px at that edge, where it would scale with the art.`,
        )[0];
    if (problem !== undefined) {
      findings.push({ code: 'padding.invalid', severity: 'error', message: problem });
    }
    return given;
  }
  if (bounds === undefined) {
    return null;
  }
  const detected = detectContentPadding(raster, bounds, {
    x: matching.x.tolerance,
    y: matching.y.tolerance,
  });
  const clamped = {
    left: Math.min(detected.left, limits.left),
    right: Math.min(detected.right, limits.right),
    top: Math.min(detected.top, limits.top),
    bottom: Math.min(detected.bottom, limits.bottom),
  };
  if (sides.some((side) => clamped[side] !== detected[side])) {
    findings.push({
      code: 'padding.clamped',
      severity: 'info',
      message:
        "The frame's inner edge lies inside a stretch span on some side, so the content padding stops at the fixed edge there; content may overlap that part of the frame.",
      details: { detected, clamped },
    });
  }
  return clamped;
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
 * @evidenceReview docs/spec.md#repeating-edges #04c566e Checked this code against the section line by line and ran tilesRepeatingEdges green with pnpm test.
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
 * @evidenceReview docs/spec.md#multiple-stretch-regions #00b2534 Re-read the section after the normalize-reports-layout and insetsSource edit, checked this code against it, and ran readsBackMultiRegionLayouts green with pnpm test.
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
 * @evidenceReview docs/spec.md#multiple-stretch-regions #00b2534 Re-read the section after the normalize-reports-layout and insetsSource edit, checked this code against it, and ran readsBackMultiRegionLayouts green with pnpm test.
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
 * Verifies a caller-given layout, such as the multi-region layout normalize
 * reports after a rebuild: its axes must match the image size, and every
 * stretch segment must be uniform.
 *
 * @evidence docs/spec.md#multiple-stretch-regions Verifies a given layout against the image size and the uniformity of each stretch segment instead of detecting one.
 * @evidenceReview docs/spec.md#multiple-stretch-regions #00b2534 Re-read the section after the normalize-reports-layout and insetsSource edit, checked this code against it, and ran readsBackMultiRegionLayouts green with pnpm test.
 */
export function verifyGivenLayout(
  raster: Raster,
  given: SliceLayout,
  matching: AxisMatching,
  findings: Finding[],
): Layout {
  const layout: SliceLayout = {
    x: rebuiltAxis(given.x, 'x'),
    y: rebuiltAxis(given.y, 'y'),
  };
  const tile = {
    x: layout.x.segments.some((segment) => segment.kind === 'tile'),
    y: layout.y.segments.some((segment) => segment.kind === 'tile'),
  };
  const envelope = (axis: AxisLayout): [number, number] => {
    const flexible = flexibleSegments(axis);
    return flexible.length === 0
      ? [0, 0]
      : [flexible[0]?.start ?? 0, axis.length - (flexible.at(-1)?.end ?? axis.length)];
  };
  const [left, right] = envelope(layout.x);
  const [top, bottom] = envelope(layout.y);
  const insets = { left, right, top, bottom };
  const shape = layoutShape(layout);
  const mode: SliceMode =
    shape === 'multi' || shape === 'three' || shape === 'three-vertical' ? shape : 'nine';
  if (layout.x.length !== raster.width || layout.y.length !== raster.height) {
    findings.push({
      code: 'layout.size',
      severity: 'error',
      message: `The layout is ${layout.x.length}x${layout.y.length} but the image is ${raster.width}x${raster.height}; use the layout reported for this image.`,
    });
    const fixed = { x: axisFromSpans(raster.width, []), y: axisFromSpans(raster.height, []) };
    return { insets, mode, tile, layout: fixed };
  }
  const full: Rect = { x: 0, y: 0, width: raster.width, height: raster.height };
  for (const axis of ['x', 'y'] as const) {
    for (const segment of layout[axis].segments) {
      if (segment.kind !== 'stretch') {
        continue;
      }
      const mismatch = firstMismatch(raster, axis, segment, full, matching[axis]);
      if (mismatch !== undefined) {
        const line = axis === 'x' ? 'columns' : 'rows';
        findings.push({
          code: `stretch.${axis}.nonuniform`,
          severity: 'error',
          message: `${line} ${mismatch} and ${mismatch + 1} differ inside a stretch segment, so stretching changes the art.`,
          details: { axis, pair: [mismatch, mismatch + 1] },
        });
      }
    }
  }
  if (shape === 'multi') {
    findings.push({
      code: 'regions.multi',
      severity: 'info',
      message: `The layout keeps ${flexibleSegments(layout.x).length} horizontal and ${flexibleSegments(layout.y).length} vertical stretch regions; no current target can export more than one region per axis.`,
      details: { x: flexibleSegments(layout.x).length, y: flexibleSegments(layout.y).length },
    });
  }
  return { insets, mode, tile, layout };
}

/** Rebuilds an axis from its flexible segments, so a malformed one throws. */
function rebuiltAxis(axis: AxisLayout, name: Axis): AxisLayout {
  const kinds = new Set(['fixed', 'stretch', 'tile']);
  if (
    typeof axis !== 'object' ||
    !Array.isArray(axis.segments) ||
    axis.segments.some((segment) => !kinds.has(segment.kind))
  ) {
    throw new RangeError(
      `The layout's ${name} axis needs a length and segments of fixed, stretch, or tile.`,
    );
  }
  const covered = axis.segments.every(
    (segment, index) => segment.start === (index === 0 ? 0 : axis.segments[index - 1]?.end),
  ) && (axis.segments.at(-1)?.end ?? 0) === axis.length;
  if (!covered) {
    throw new RangeError(`The layout's ${name} segments must cover 0..${axis.length} in order.`);
  }
  return axisFromSpans(
    axis.length,
    flexibleSegments(axis).map((segment) => ({
      start: segment.start,
      end: segment.end,
      kind: segment.kind === 'tile' ? ('tile' as const) : ('stretch' as const),
    })),
  );
}

/**
 * @evidence docs/spec.md#slice-insets Rejects caller insets that leave no stretch span.
 * @evidenceReview docs/spec.md#slice-insets #09153ff Checked this code against the section line by line and ran rejectsInsetsWithoutAStretchSpan green with pnpm test.
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
 * @evidenceReview docs/spec.md#chroma-spill #e573ace Checked this code against the section line by line and ran flagsChromaSpill green with pnpm test.
 */
export function chromaSpillFindings(raster: Raster): Finding[] {
  // Edge pixels against the art's own opaque pixels: pink or purple art is
  // magenta-dominated everywhere, while spill tints only the edge.
  const edge = { pixels: 0, green: 0, magenta: 0 };
  const art = { pixels: 0, green: 0, magenta: 0 };
  // A fringe hugs the cut-out: the edge is every visible pixel within
  // spillReach of a fully transparent one, so a translucent fill inside the
  // element (glass) counts as art.
  const nearTransparency = nearTransparentMask(raster, spillReach);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const alpha = alphaAt(raster, x, y);
      if (alpha === 0) {
        continue;
      }
      const tally = nearTransparency[y * raster.width + x] === 1 ? edge : art;
      tally.pixels += 1;
      const offset = pixelOffset(raster, x, y);
      const r = raster.data[offset] ?? 0;
      const g = raster.data[offset + 1] ?? 0;
      const b = raster.data[offset + 2] ?? 0;
      if (g - Math.max(r, b) > spillDominance) {
        tally.green += 1;
      } else if (Math.min(r, b) - g > spillDominance) {
        tally.magenta += 1;
      }
    }
  }
  const share = (count: number, total: number): number => (total === 0 ? 0 : count / total);
  // With no art pixels there is no baseline: a thin all-edge sprite in a key
  // color would otherwise always look like spill.
  if (art.pixels === 0) {
    return [];
  }
  const spilled = (key: 'green' | 'magenta'): boolean => {
    const onEdge = share(edge[key], edge.pixels);
    return onEdge > spillRatio && onEdge > share(art[key], art.pixels) * spillContrast;
  };
  // Report the stronger key when both qualify.
  const key = (['green', 'magenta'] as const)
    .filter((candidate) => spilled(candidate))
    .sort((a, b) => edge[b] - edge[a])[0];
  if (key === undefined) {
    return [];
  }
  return [
    {
      code: 'alpha.chroma-spill',
      severity: 'warning',
      message: `${edge[key]} of ${edge.pixels} alpha-edge pixels are tinted by the ${key} key, far more than the art's own ${key} share. Despill or re-key before slicing; a deliberate ${key} glow or outline is fine.`,
      details: {
        edgePixels: edge.pixels,
        green: edge.green,
        magenta: edge.magenta,
        artPixels: art.pixels,
        artGreen: art.green,
        artMagenta: art.magenta,
      },
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
 * @evidenceReview docs/spec.md#interior-alpha #f158aa3 Checked this code against the section line by line and ran flagsInteriorAlphaHoles green with pnpm test.
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
      if (alpha > 0 && alpha < opaqueAlpha) {
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
      details: {
        partial,
        total,
        region: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
      },
    },
  ];
}

/**
 * 1 for every pixel within `reach` (square distance) of a fully transparent
 * pixel or of the image border, whose pixels seed the band like transparent ones.
 */
function nearTransparentMask(raster: Raster, reach: number): Uint8Array {
  const { width, height } = raster;
  let mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (border || alphaAt(raster, x, y) === 0) {
        mask[y * width + x] = 1;
      }
    }
  }
  for (let step = 0; step < reach; step += 1) {
    const next = new Uint8Array(mask);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (mask[y * width + x] === 1) {
          continue;
        }
        // Border pixels are already set, so every neighbor here is in range.
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy += 1) {
          for (let dx = -1; dx <= 1 && !near; dx += 1) {
            near = mask[(y + dy) * width + (x + dx)] === 1;
          }
        }
        if (near) {
          next[y * width + x] = 1;
        }
      }
    }
    mask = next;
  }
  return mask;
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

/** Fixed segments above this share of a resizable axis leave little room to resize. */
const largeInsetRatio = 0.5;

/**
 * Warns when the fixed segments take most of an axis that resizes, so the art
 * cannot shrink much below its source size and only a short span stretches.
 *
 * @evidence docs/spec.md#slice-insets Warns when fixed segments take more than half of a resizable axis.
 * @evidenceReview docs/spec.md#slice-insets #09153ff Checked this code against the section line by line and ran rejectsInsetsWithoutAStretchSpan green with pnpm test.
 */
export function largeInsetFindings(layout: SliceLayout): Finding[] {
  const minimum = minimumLayoutSize(layout);
  return (['x', 'y'] as const).flatMap((axis) => {
    const length = layout[axis].length;
    const fixed = axis === 'x' ? minimum.width : minimum.height;
    if (flexibleSegments(layout[axis]).length === 0 || fixed <= length * largeInsetRatio) {
      return [];
    }
    const dimension = axis === 'x' ? 'width' : 'height';
    return [
      {
        code: `insets.large`,
        severity: 'warning' as const,
        message: `The fixed parts take ${fixed} of ${length} px of the ${dimension}, so it cannot go below ${fixed} px and only ${length - fixed} px stretches. Detail along the edge often causes this; regenerate with plainer edges or check the tolerance. If the ends are rounded across the whole ${dimension === 'height' ? 'height (a pill or capsule), keep the height with --mode three' : 'width, keep the width with --mode three-vertical'}.`,
        details: { axis, fixed, length },
      },
    ];
  });
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
