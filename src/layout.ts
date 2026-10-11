import type { TileAxes } from './inspect.js';
import type { SliceInsets } from './slices.js';

/** How one run of source lines behaves when its axis is resized. */
export type SegmentKind = 'fixed' | 'stretch' | 'tile';

/** Source lines `start` (inclusive) to `end` (exclusive) on one axis. */
export interface Segment {
  readonly start: number;
  readonly end: number;
  readonly kind: SegmentKind;
}

/** One axis of a layout: segments that cover `0..length` in order. */
export interface AxisLayout {
  readonly length: number;
  readonly segments: readonly Segment[];
}

/** Engine-neutral slice layout: every slicing scheme is a pair of segmented axes. */
export interface SliceLayout {
  readonly x: AxisLayout;
  readonly y: AxisLayout;
  /**
   * Where content such as text sits, measured from each edge. On an axis that
   * resizes it stays within the fixed segments at that edge, so it never
   * changes with size.
   */
  readonly content?: SliceInsets;
}

/**
 * Common names for layouts. `nine` and `three` follow Phaser; `three-vertical`
 * keeps the width; `multi` has an axis with more than one flexible segment;
 * `fixed` resizes on neither axis.
 */
export type LayoutShape = 'nine' | 'three' | 'three-vertical' | 'multi' | 'fixed';

/**
 * Builds an axis from its flexible spans, filling the gaps with fixed
 * segments. Spans must be in order, inside the axis, and not overlap.
 *
 * @evidence docs/spec.md#slice-layouts Covers the axis with the given flexible spans and fixed gaps, in order.
 * @evidenceReview docs/spec.md#slice-layouts #fc52f65 Checked this code against the section line by line and ran describesSliceLayouts green with pnpm test.
 */
export function axisFromSpans(
  length: number,
  spans: ReadonlyArray<{ readonly start: number; readonly end: number; readonly kind: 'stretch' | 'tile' }>,
): AxisLayout {
  const segments: Segment[] = [];
  let cursor = 0;
  if (!Number.isInteger(length) || length < 1) {
    throw new RangeError(`An axis needs a whole, positive length, got ${length}.`);
  }
  for (const span of spans) {
    if (!Number.isInteger(span.start) || !Number.isInteger(span.end)) {
      throw new RangeError(`Span ${span.start}..${span.end} must use whole pixels.`);
    }
    if (span.start < cursor || span.end <= span.start || span.end > length) {
      throw new RangeError(
        `Span ${span.start}..${span.end} does not fit the axis after ${cursor} of ${length}.`,
      );
    }
    if (span.start > cursor) {
      segments.push({ start: cursor, end: span.start, kind: 'fixed' });
    }
    segments.push(span);
    cursor = span.end;
  }
  if (cursor < length) {
    segments.push({ start: cursor, end: length, kind: 'fixed' });
  }
  return { length, segments };
}

/**
 * Converts insets into a layout. A three-slice keeps its height and a
 * vertical three-slice keeps its width; otherwise each axis has one flexible
 * span between its insets, tiled when `tile` says so.
 *
 * @evidence docs/spec.md#slice-layouts Maps insets, three-slice, vertical three-slice, and tiling onto segmented axes.
 * @evidenceReview docs/spec.md#slice-layouts #fc52f65 Checked this code against the section line by line and ran describesSliceLayouts green with pnpm test.
 */
export function layoutFromInsets(
  insets: SliceInsets,
  width: number,
  height: number,
  options: {
    readonly shape?: 'nine' | 'three' | 'three-vertical';
    readonly tile?: TileAxes;
    readonly content?: SliceInsets;
  } = {},
): SliceLayout {
  const shape = options.shape ?? 'nine';
  const kind = (axis: 'x' | 'y'): 'stretch' | 'tile' => (options.tile?.[axis] === true
    ? 'tile'
    : 'stretch');
  const x =
    shape === 'three-vertical'
      ? axisFromSpans(width, [])
      : axisFromSpans(width, [{ start: insets.left, end: width - insets.right, kind: kind('x') }]);
  const y =
    shape === 'three'
      ? axisFromSpans(height, [])
      : axisFromSpans(height, [{ start: insets.top, end: height - insets.bottom, kind: kind('y') }]);
  return { x, y, ...(options.content === undefined ? {} : { content: options.content }) };
}

export function flexibleSegments(axis: AxisLayout): Segment[] {
  return axis.segments.filter((segment) => segment.kind !== 'fixed');
}

/**
 * @evidence docs/spec.md#slice-layouts Names the shape from the number of flexible segments per axis.
 * @evidenceReview docs/spec.md#slice-layouts #fc52f65 Checked this code against the section line by line and ran describesSliceLayouts green with pnpm test.
 */
export function layoutShape(layout: SliceLayout): LayoutShape {
  const x = flexibleSegments(layout.x).length;
  const y = flexibleSegments(layout.y).length;
  if (x > 1 || y > 1) {
    return 'multi';
  }
  if (x === 0 && y === 0) {
    return 'fixed';
  }
  if (y === 0) {
    return 'three';
  }
  if (x === 0) {
    return 'three-vertical';
  }
  return 'nine';
}

/**
 * Insets of a layout with at most one flexible segment per axis. A fixed
 * axis reports zero insets on both sides, the way Phaser encodes a
 * three-slice height. Undefined for a multi-region layout.
 */
export function layoutInsets(layout: SliceLayout): SliceInsets | undefined {
  const x = flexibleSegments(layout.x);
  const y = flexibleSegments(layout.y);
  if (x.length > 1 || y.length > 1) {
    return undefined;
  }
  return {
    left: x[0]?.start ?? 0,
    right: x[0] === undefined ? 0 : layout.x.length - x[0].end,
    top: y[0]?.start ?? 0,
    bottom: y[0] === undefined ? 0 : layout.y.length - y[0].end,
  };
}

/**
 * Smallest size the layout renders at: the fixed segments, or the whole axis
 * when nothing on it is flexible.
 *
 * @evidence docs/spec.md#slice-layouts Sums the fixed segments per axis, keeping a fully fixed axis whole.
 * @evidenceReview docs/spec.md#slice-layouts #fc52f65 Checked this code against the section line by line and ran describesSliceLayouts green with pnpm test.
 */
export function minimumLayoutSize(layout: SliceLayout): { width: number; height: number } {
  const fixed = (axis: AxisLayout): number =>
    axis.segments
      .filter((segment) => segment.kind === 'fixed')
      .reduce((sum, segment) => sum + segment.end - segment.start, 0);
  return { width: fixed(layout.x), height: fixed(layout.y) };
}

/** True when `axis` tiles anywhere. */
export function axisTiles(axis: AxisLayout): boolean {
  return axis.segments.some((segment) => segment.kind === 'tile');
}

/**
 * The most content padding each edge can hold without reaching a flexible
 * segment: the fixed run at that edge, or the whole axis when it never resizes.
 *
 * @evidence docs/spec.md#content-padding Bounds each side's padding by the fixed segments at that edge.
 * @evidenceReview docs/spec.md#content-padding #51d3985 Checked this code against the section line by line and ran detectsContentPadding green with pnpm test.
 */
export function contentLimits(layout: SliceLayout): SliceInsets {
  const ends = (axis: AxisLayout): [number, number] => {
    const flexible = flexibleSegments(axis);
    const first = flexible[0];
    const last = flexible.at(-1);
    return first === undefined || last === undefined
      ? [axis.length, axis.length]
      : [first.start, axis.length - last.end];
  };
  const [left, right] = ends(layout.x);
  const [top, bottom] = ends(layout.y);
  return { left, right, top, bottom };
}
