import typia from 'typia';

import type { PromptPlan } from './prompt.js';

/** The part of an inspect, normalize, compare, or build report a correction reads. */
export interface FindingsReport {
  readonly findings: readonly ReportFinding[];
}

export interface ReportFinding {
  readonly code: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly message?: string;
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
    'The states of this element differed in size last time: draw every state at exactly the same size and framing.',
  'compare.insets':
    'The states of this element had different borders last time: keep the frame identical across states and change only the colors.',
  'compare.outline':
    'The states of this element had different outline thicknesses last time: keep the outline the same thickness in every state.',
  'pixel.off-grid':
    'The pixel art was blurred or anti-aliased last time: draw crisp pixels on one consistent grid, every pixel a single flat color.',
};

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
 * @evidenceReview docs/spec.md#prompt-corrections #0ff6b1c Checked this code against the section line by line and ran correctsPrompts green with pnpm test.
 */
export function readFindingsReport(json: unknown, piece?: string): FindingsReport {
  if (typia.is<PiecesReport>(json)) {
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
    throw new RangeError('A piece is picked only from a build report.');
  }
  return typia.assert<FindingsReport>(json);
}

/**
 * The correction lines for a report's warnings and errors, once each in
 * finding order; info findings and codes about slicing or export add none.
 *
 * @evidence docs/spec.md#prompt-corrections Maps warnings and errors to correction lines by code, axis-aware, deduplicated, ignoring info and unmapped codes.
 * @evidenceReview docs/spec.md#prompt-corrections #0ff6b1c Checked this code against the section line by line and ran correctsPrompts green with pnpm test.
 */
export function promptCorrections(report: FindingsReport): string[] {
  const lines: string[] = [];
  for (const finding of report.findings) {
    if (finding.severity === 'info') {
      continue;
    }
    const axis = /\.(x|y)\./.exec(finding.code)?.[1];
    const key = axis === undefined ? finding.code : finding.code.replace(`.${axis}.`, '.axis.');
    const template = corrections[key];
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
 * @evidenceReview docs/spec.md#prompt-corrections #0ff6b1c Checked this code against the section line by line and ran correctsPrompts green with pnpm test.
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
