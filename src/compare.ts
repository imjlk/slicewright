import {
  inspectRaster,
  type Finding,
  type InspectOptions,
  type InspectReport,
  type TileAxes,
} from './inspect.js';
import { outlineThickness } from './outline.js';
import type { Raster } from './raster.js';
import type { SliceInsets, SliceMode } from './slices.js';

/**
 * `states` are one element drawn several ways (normal, hover, pressed,
 * disabled) that swap in place, so they must share a size and slices. A `set`
 * is different elements made to match (a dialog, a button, a bar), which only
 * share a line weight.
 */
export type CompareKind = 'states' | 'set';

export interface ComparePiece {
  readonly name: string;
  readonly raster: Raster;
}

export interface CompareOptions {
  readonly kind: CompareKind;
  /** Pixels insets and content padding may differ by before a state is reported. */
  readonly slack: number;
  readonly inspect: InspectOptions;
}

export interface ComparePieceReport {
  readonly name: string;
  readonly ok: boolean;
  readonly width: number;
  readonly height: number;
  readonly mode: SliceMode;
  readonly insets: SliceInsets;
  readonly contentPadding: SliceInsets | null;
  /** Axes that tile, as given or detected. */
  readonly tile: TileAxes;
  /** Outline thickness in pixels, or null when no outline was found. */
  readonly outline: number | null;
  readonly findings: readonly Finding[];
}

export interface CompareReport {
  readonly ok: boolean;
  readonly kind: CompareKind;
  readonly pieces: readonly ComparePieceReport[];
  /**
   * For states, the largest inset on each side, which every state is checked
   * with; null for a set, or when the states cannot share one layout.
   */
  readonly sharedInsets: SliceInsets | null;
  readonly findings: readonly Finding[];
}

export const defaultCompareSlack = 1;

/** Outlines this many times thicker than the thinnest read as a different weight. */
const outlineRatio = 1.25;
/** Outlines closer than this many pixels always match, whatever the ratio. */
const outlineFloor = 1;

const sides = ['left', 'right', 'top', 'bottom'] as const;

/**
 * Compares the pieces of a matching set or the states of one element. Each
 * piece is inspected on its own; states must also have one size and one slice
 * mode, their insets and content padding may differ by at most the slack, and
 * every state must hold the largest inset on each side, since one NineSlice
 * swaps between their frames. Any two pieces whose outlines differ by more
 * than 1 px and a quarter are reported for both kinds.
 *
 * @evidence docs/spec.md#set-comparison Inspects each piece, checks states for one size, mode, slack-bound insets and padding, and the shared largest insets, and compares outline weights for states and sets.
 * @evidenceReview docs/spec.md#set-comparison #c59c7f7 Checked this code against the section line by line and ran comparesSets green with pnpm test.
 */
export function compareSet(
  pieces: readonly ComparePiece[],
  options: CompareOptions,
): CompareReport {
  if (pieces.length < 2) {
    throw new RangeError('Compare needs at least two images.');
  }
  if (new Set(pieces.map((piece) => piece.name)).size !== pieces.length) {
    throw new RangeError('Every compared image needs its own name.');
  }
  if (!Number.isInteger(options.slack) || options.slack < 0) {
    throw new RangeError('The slack must be a whole, non-negative number of pixels.');
  }
  if (
    options.kind === 'states' &&
    (options.inspect.insets !== undefined || options.inspect.contentPadding !== undefined)
  ) {
    // Given geometry would be the same for every state and hide the drift being compared.
    throw new RangeError('States are compared by their detected insets and padding; give neither.');
  }
  if (options.kind === 'states' && options.inspect.regions === 'multi') {
    // Shared insets describe one stretch span per axis; multi-region layouts have several.
    throw new RangeError('States are compared with single-region layouts.');
  }
  const inspected = pieces.map((piece) => ({
    piece,
    report: inspectRaster(piece.raster, options.inspect),
    outline: outlineThickness(piece.raster),
  }));
  const findings: Finding[] = [];
  let sharedInsets: SliceInsets | null = null;

  if (options.kind === 'states') {
    findings.push(...stateFindings(inspected, options.slack));
    const comparable = !findings.some((finding) => finding.severity === 'error');
    if (comparable) {
      sharedInsets = largestInsets(inspected.map(({ report }) => report.insets));
      findings.push(...sharedInsetFindings(inspected, sharedInsets, options.inspect));
    }
  }
  findings.push(...outlineFindings(inspected));

  const reports = inspected.map(({ piece, report, outline }) =>
    pieceReport(piece, report, outline),
  );
  return {
    ok:
      !findings.some((finding) => finding.severity === 'error') &&
      reports.every((report) => report.ok),
    kind: options.kind,
    pieces: reports,
    sharedInsets,
    findings,
  };
}

interface Inspected {
  readonly piece: ComparePiece;
  readonly report: InspectReport;
  readonly outline: number | undefined;
}

function pieceReport(
  piece: ComparePiece,
  report: InspectReport,
  outline: number | undefined,
): ComparePieceReport {
  return {
    name: piece.name,
    ok: report.ok,
    width: report.width,
    height: report.height,
    mode: report.mode,
    insets: report.insets,
    contentPadding: report.contentPadding,
    tile: report.tile,
    outline: outline === undefined ? null : Math.round(outline * 100) / 100,
    findings: report.findings,
  };
}

function stateFindings(inspected: readonly Inspected[], slack: number): Finding[] {
  const findings: Finding[] = [];
  const sizes = inspected.map(({ piece, report }) => ({
    name: piece.name,
    width: report.width,
    height: report.height,
  }));
  if (new Set(sizes.map(({ width, height }) => `${width}x${height}`)).size > 1) {
    findings.push({
      code: 'compare.size',
      severity: 'error',
      message: 'States of one element must have the same size; normalize them to one size.',
      details: { sizes },
    });
  }
  const modes = inspected.map(({ piece, report }) => ({ name: piece.name, mode: report.mode }));
  if (new Set(modes.map(({ mode }) => mode)).size > 1) {
    findings.push({
      code: 'compare.mode',
      severity: 'error',
      message: 'States slice differently (nine, three, or vertical three); pass one --mode.',
      details: { modes },
    });
  }
  // Phaser takes tiling only in the NineSlice constructor, so swapped states share it.
  const tiles = inspected.map(({ piece, report }) => ({ name: piece.name, tile: report.tile }));
  if (new Set(tiles.map(({ tile }) => `${tile.x},${tile.y}`)).size > 1) {
    findings.push({
      code: 'compare.tile',
      severity: 'error',
      message: 'States tile different axes; regenerate them alike or pass one --tile.',
      details: { tiles },
    });
  }
  const insets = spread(inspected.map(({ piece, report }) => [piece.name, report.insets]));
  if (insets.some(({ spread: amount }) => amount > slack)) {
    findings.push({
      code: 'compare.insets',
      severity: 'warning',
      message: `Detected insets differ by more than ${slack} px between states; the corners would jump when they swap.`,
      details: { sides: insets.filter(({ spread: amount }) => amount > slack) },
    });
  }
  const withPadding = inspected.flatMap(({ piece, report }) =>
    report.contentPadding === null ? [] : [[piece.name, report.contentPadding] as const],
  );
  const padding = spread(withPadding);
  if (padding.some(({ spread: amount }) => amount > slack)) {
    findings.push({
      code: 'compare.padding',
      severity: 'warning',
      message: `Content padding differs by more than ${slack} px between states, so text moves when they swap; give one --padding if that is not intended.`,
      details: { sides: padding.filter(({ spread: amount }) => amount > slack) },
    });
  }
  return findings;
}

/** Per side, the range of values across the pieces and which piece holds each end. */
function spread(
  entries: ReadonlyArray<readonly [string, SliceInsets]>,
): Array<{ side: string; spread: number; values: Record<string, number> }> {
  return sides.map((side) => {
    const values = Object.fromEntries(entries.map(([name, insets]) => [name, insets[side]]));
    const all = Object.values(values);
    return {
      side,
      spread: all.length === 0 ? 0 : Math.max(...all) - Math.min(...all),
      values,
    };
  });
}

function largestInsets(all: readonly SliceInsets[]): SliceInsets {
  const largest = (side: (typeof sides)[number]): number =>
    Math.max(...all.map((insets) => insets[side]));
  return {
    left: largest('left'),
    right: largest('right'),
    top: largest('top'),
    bottom: largest('bottom'),
  };
}

/** Every state, inspected with the shared insets, must still stretch cleanly. */
function sharedInsetFindings(
  inspected: readonly Inspected[],
  shared: SliceInsets,
  options: InspectOptions,
): Finding[] {
  const failing = inspected.flatMap(({ piece, report }) => {
    if (report.mode === 'multi') {
      // Unreachable: states are rejected above when regions are multi.
      return [];
    }
    // Keep the tiling each state detected, so a repeating edge is not checked as a stretch.
    const check = inspectRaster(piece.raster, {
      ...options,
      mode: report.mode,
      insets: shared,
      tile: { x: options.tile.x || report.tile.x, y: options.tile.y || report.tile.y },
    });
    const errors = check.findings.filter((finding) => finding.severity === 'error');
    return errors.length === 0 ? [] : [{ name: piece.name, codes: errors.map((e) => e.code) }];
  });
  if (failing.length === 0) {
    return [];
  }
  return [
    {
      code: 'compare.shared-insets',
      severity: 'error',
      message:
        'No one set of insets fits every state: the largest inset on each side cuts into detail in some states.',
      details: { insets: shared, failing },
    },
  ];
}

function outlineFindings(inspected: readonly Inspected[]): Finding[] {
  const measured = inspected.flatMap(({ piece, outline }) =>
    outline === undefined ? [] : [{ name: piece.name, outline }],
  );
  const findings: Finding[] = [];
  const missing = inspected.filter(({ outline }) => outline === undefined);
  if (missing.length > 0) {
    findings.push({
      code: 'compare.outline-missing',
      severity: 'info',
      message:
        measured.length === 0
          ? 'No piece has a measurable outline, so line weight was not compared.'
          : 'Some pieces have no measurable outline, so their line weight was not compared.',
      details: { pieces: missing.map(({ piece }) => piece.name) },
    });
  }
  if (measured.length < 2) {
    return findings;
  }
  const thinnest = measured.reduce((a, b) => (b.outline < a.outline ? b : a));
  const thickest = measured.reduce((a, b) => (b.outline > a.outline ? b : a));
  if (
    thickest.outline - thinnest.outline > outlineFloor &&
    thickest.outline > thinnest.outline * outlineRatio
  ) {
    findings.push({
      code: 'compare.outline',
      severity: 'warning',
      message: `Outlines range from ${round(thinnest.outline)} px (${thinnest.name}) to ${round(thickest.outline)} px (${thickest.name}), so the pieces read as different line weights.`,
      details: {
        outlines: Object.fromEntries(measured.map(({ name, outline }) => [name, round(outline)])),
      },
    });
  }
  return findings;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
