import type { Finding } from '../inspect.js';
import { capabilityFindings } from './common.js';
import { cssTarget } from './css.js';
import { godotTarget } from './godot.js';
import { ninePatchTarget } from './ninepatch.js';
import { phaserTarget } from './phaser.js';
import type { ExportInput, ExportResult, SliceTarget } from './types.js';
import { unityTarget } from './unity.js';

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
  [phaserTarget, cssTarget, godotTarget, unityTarget, ninePatchTarget].map((target) => [
    target.id,
    target,
  ]),
);

/**
 * Exports a layout for one target. A layout the target cannot represent
 * produces its findings and no files.
 *
 * @evidence docs/spec.md#targets Looks the target up, checks capabilities, and writes files only when no error remains.
 * @evidenceReview docs/spec.md#targets #a3f3c6c Checked this code against the section line by line and ran checksTargetCapabilities green with pnpm test.
 */
export function exportForTarget(id: string, input: ExportInput): ExportResult {
  const target = sliceTargets[id];
  if (target === undefined) {
    throw new Error(
      `Unknown target "${id}". Known targets: ${Object.keys(sliceTargets).join(', ')}.`,
    );
  }
  const findings: Finding[] = capabilityFindings(target, input.layout);
  if (findings.some((finding) => finding.severity === 'error')) {
    return { target: id, files: [], usage: '', findings };
  }
  return { target: id, ...target.exportLayout(input), findings };
}
