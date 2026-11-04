import typia from 'typia';

import { multiRegionBody } from './multi-region.js';
import type { PromptPlan } from './prompt.js';

/** The part of an inspect, normalize, compare, or build report a correction reads. */
export interface FindingsReport {
  readonly findings: readonly ReportFinding[];
}

export interface ReportFinding {
  readonly code: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly message?: string;
  /** Kept so a `regions.multi` correction can read stretch counts. Other shapes are ignored. */
  readonly details?: unknown;
}

/**
 * Correction lines per finding code, with the axis (`.x.` or `.y.`) written
 * as `.axis.` and filled in as horizontal or vertical. Codes about how the
 * art is sliced or exported, not how it is drawn, have none.
 */
const corrections: Readonly<Record<string, string>> = {
  'stretch.axis.nonuniform':
    'The {edges} edges changed along their length last time: keep them one plain band with no pattern, shading change, or detail between the corners.',
  'stretch.axis.none':
    'Last time no two adjacent {lines} matched, so nothing could stretch: make the {edges} edges and the center perfectly plain and even, with no gradient along the {direction} direction.',
  'stretch.axis.short':
    'Last time the {edges} edges carried detail all along them (vines, rope, ornaments): keep the decoration in the corners and leave long plain runs between them.',
  'tile.axis.seam':
    'The {edges} edge pattern did not repeat cleanly last time: make the pattern seamless and evenly repeating, or make the edges plain.',
  'insets.large':
    'The corners took most of the element last time: make the corner ornaments smaller and the plain edges and center larger.',
  'insets.asymmetric':
    'The corners differed in size last time: make the frame symmetric, with all four corners the same size.',
  'noise.high':
    'The art was noisy or textured last time: use smooth flat fills with no grain, noise, or painterly texture.',
  'alpha.interior':
    'The inside of the element was partly transparent last time: make the fill fully opaque, with transparency only outside the outline.',
  'alpha.chroma-spill':
    'The edges picked up the background color last time: keep a clean, hard outline with none of the background color in it.',
  'margin.transparent':
    'There was a wide empty margin last time: fill the canvas edge to edge with the element.',
  'resize.thin-lines':
    'Outlines were too thin to survive downscaling last time: draw thicker, bolder outlines and rims.',
  'image.empty': 'The last image came out fully transparent: draw the element on the requested background.',
  'compare.size':
    'The images meant to match (states of one element, or pieces of one set) differed in size last time: draw every one at exactly the same size and framing.',
  'compare.insets':
    'The images meant to match (states of one element, or pieces of one set) had different borders last time: keep the frame identical across them and change only the colors.',
  'compare.outline':
    'The images meant to match (states of one element, or pieces of one set) had different outline thicknesses last time: keep the outline the same thickness in every one.',
  'pixel.off-grid':
    'The pixel art was blurred or anti-aliased last time: draw crisp pixels on one consistent grid, every pixel a single flat color.',
};

const regionsMultiFallback =
  'Fixed detail sat in the middle of an edge last time (a crest or a tail): keep it out of this image and draw it afterwards as its own sprite on a plain nine-slice, three-slice, or vertical three-slice body, matching which axes still resize.';

/** Uses recorded stretch counts when they name one body; otherwise lists all three. */
function regionsMultiCorrection(details: unknown): string {
  if (typeof details !== 'object' || details === null) {
    return regionsMultiFallback;
  }
  const counts = details as { readonly x?: unknown; readonly y?: unknown };
  const x = counts.x;
  const y = counts.y;
  const counted =
    typeof x === 'number' &&
    typeof y === 'number' &&
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    y >= 0 &&
    (x > 1 || y > 1);
  if (!counted) {
    return regionsMultiFallback;
  }
  return `Fixed detail sat in the middle of an edge last time (a crest or a tail): keep it out of this image and draw it afterwards as its own sprite on a plain ${multiRegionBody(x, y)} body.`;
}

/** A build report: each piece carries its own findings. */
interface PiecesReport {
  readonly pieces: ReadonlyArray<{ readonly name: string } & FindingsReport>;
}

/**
 * Validates a report read from JSON with typia: any object with a list of
 * findings that each carry a code and a severity, or a build report, whose
 * piece is picked by name (or is its only piece).
 *
 * @evidence docs/spec.md#prompt-corrections Accepts any report with findings, or one piece of a build report, checked with typia.
 * @evidenceReview docs/spec.md#prompt-corrections #090f796 Reread the report-shape rules. This still accepts a findings list or one build piece via typia, and does not interpret codes.
 */
export function readFindingsReport(json: unknown, piece?: string): FindingsReport {
  // A compare report also lists pieces, but its own findings come first and
  // hold the set-wide codes, so only a report without them is a build report.
  if (typia.is<FindingsReport>(json)) {
    if (piece === undefined) {
      return json;
    }
    const picked = typia.is<PiecesReport>(json)
      ? json.pieces.find((item) => item.name === piece)
      : undefined;
    if (picked === undefined) {
      throw new RangeError(`No piece named ${piece} in the report.`);
    }
    return { findings: [...json.findings, ...picked.findings] };
  }
  const ownFindings = typeof json === 'object' && json !== null && Object.hasOwn(json, 'findings');
  if (!ownFindings && typia.is<PiecesReport>(json)) {
    const names = json.pieces.map((item) => item.name);
    const picked =
      piece === undefined && json.pieces.length === 1
        ? json.pieces[0]
        : json.pieces.find((item) => item.name === piece);
    if (picked === undefined) {
      throw new RangeError(
        `${piece === undefined ? 'Pick a piece of the build report' : `No piece named ${piece}`}: ${names.join(', ')}.`,
      );
    }
    return picked;
  }
  if (piece !== undefined) {
    throw new RangeError('A piece is picked only from a build or compare report.');
  }
  return typia.assert<FindingsReport>(json);
}

/**
 * The correction lines for a report's warnings and errors, once each in
 * finding order. Info findings add none, except `regions.multi`. Codes about
 * slicing or export add none.
 *
 * @evidence docs/spec.md#prompt-corrections Maps warnings and errors to correction lines by code, axis-aware and deduplicated. regions.multi is included despite being info, and names one body when its details record the stretch counts. Unmapped export codes add none.
 * @evidenceReview docs/spec.md#prompt-corrections #090f796 Reread the count rule. Recorded nonnegative integer counts with one axis above one name that body; missing or unusable counts still list all three. Other info and target.unsupported add nothing.
 */
export function promptCorrections(report: FindingsReport): string[] {
  const lines: string[] = [];
  for (const finding of report.findings) {
    if (finding.code === 'regions.multi') {
      const line = regionsMultiCorrection(finding.details);
      if (!lines.includes(line)) {
        lines.push(line);
      }
      continue;
    }
    if (finding.severity === 'info') {
      continue;
    }
    const axis = /\.(x|y)\./.exec(finding.code)?.[1];
    const key = axis === undefined ? finding.code : finding.code.replace(`.${axis}.`, '.axis.');
    const template = Object.hasOwn(corrections, key) ? corrections[key] : undefined;
    if (template === undefined) {
      continue;
    }
    const line = template
      .replaceAll('{edges}', axis === 'y' ? 'left and right' : 'top and bottom')
      .replaceAll('{lines}', axis === 'y' ? 'rows' : 'columns')
      .replaceAll('{direction}', axis === 'y' ? 'vertical' : 'horizontal');
    if (!lines.includes(line)) {
      lines.push(line);
    }
  }
  return lines;
}

/**
 * Appends the corrections to a plan's prompt and lists them.
 *
 * @evidence docs/spec.md#prompt-corrections Appends the corrections after the prompt under one heading line and lists them in the plan.
 * @evidenceReview docs/spec.md#prompt-corrections #090f796 Reread the append rule. Lines still go under one heading and are listed as corrections; an empty list leaves the prompt unchanged.
 */
export function correctPromptPlan(
  plan: PromptPlan,
  lines: readonly string[],
): PromptPlan & { readonly corrections: readonly string[] } {
  return {
    ...plan,
    prompt:
      lines.length === 0
        ? plan.prompt
        : `${plan.prompt}\nCorrections from the previous attempt:\n${lines.map((line) => `- ${line}`).join('\n')}`,
    corrections: lines,
  };
}
