import type { Finding } from '../inspect.js';
import { contentLimits } from '../layout.js';
import { paddingProblem } from '../padding.js';
import { capabilityFindings } from './common.js';
import { cssTarget } from './css.js';
import { defoldTarget } from './defold.js';
import { godotTarget } from './godot.js';
import { phaserTarget } from './phaser.js';
import { unityTarget } from './unity.js';
import type { ExportInput, ExportResult, SliceTarget } from './types.js';

export type {
  ExportFile,
  ExportInput,
  ExportResult,
  SliceTarget,
  TargetCapabilities,
} from './types.js';
export { capabilityFindings } from './common.js';

/** Every export target, keyed by id. Add a target by adding it here. */
export const sliceTargets: Readonly<Record<string, SliceTarget>> = Object.fromEntries(
  [phaserTarget, cssTarget, unityTarget, defoldTarget, godotTarget].map((target) => [
    target.id,
    target,
  ]),
);

/** The registered target with this id; inherited object keys never match. */
export function findTarget(id: string): SliceTarget | undefined {
  return Object.hasOwn(sliceTargets, id) ? sliceTargets[id] : undefined;
}

/**
 * Exports a layout for one target. A layout the target cannot represent
 * produces its findings and no files.
 *
 * @evidence docs/spec.md#targets Looks the target up, checks capabilities, and writes files only when no error remains.
 * @evidenceReview docs/spec.md#targets #01a5af9 Checked this code against the section line by line and ran checksTargetCapabilities green with pnpm test.
 */
export function exportForTarget(id: string, input: ExportInput): ExportResult {
  const target = findTarget(id);
  if (target === undefined) {
    throw new Error(
      `Unknown target "${id}". Known targets: ${Object.keys(sliceTargets).join(', ')}.`,
    );
  }
  if (input.layout.x.length !== input.raster.width || input.layout.y.length !== input.raster.height) {
    throw new RangeError(
      `The layout is ${input.layout.x.length}x${input.layout.y.length} but the image is ${input.raster.width}x${input.raster.height}.`,
    );
  }
  const content = input.layout.content;
  const limits = contentLimits(input.layout);
  const contentProblem =
    content === undefined
      ? undefined
      : (paddingProblem(content, input.raster.width, input.raster.height) ??
        (['left', 'right', 'top', 'bottom'] as const)
          .filter((side) => content[side] > limits[side])
          .map(
            (side) =>
              `${side} content padding ${content[side]} reaches past the fixed ${limits[side]} px at that edge, where it would scale with the art.`,
          )[0]);
  if (contentProblem !== undefined) {
    throw new RangeError(contentProblem);
  }
  const findings: Finding[] = capabilityFindings(target, input.layout);
  if (findings.some((finding) => finding.severity === 'error')) {
    return { target: id, files: [], usage: '', findings };
  }
  return { target: id, ...target.exportLayout(input), findings };
}
