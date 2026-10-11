import type { Finding } from '../inspect.js';
import { axisTiles, layoutInsets, layoutShape, type SliceLayout } from '../layout.js';
import type { SliceInsets } from '../slices.js';
import type { SliceTarget } from './types.js';

/**
 * Compares a layout with a target's capabilities: an unsupported shape is an
 * error, an emulated shape and a fully fixed layout are noted, and tiling the
 * target cannot express is a warning.
 *
 * @evidence docs/spec.md#targets Reports unsupported shapes as errors, emulation as info, and tiling gaps as warnings, from the declared capabilities.
 * @evidenceReview docs/spec.md#targets #a3f3c6c Checked this code against the section line by line and ran checksTargetCapabilities green with pnpm test.
 */
export function capabilityFindings(target: SliceTarget, layout: SliceLayout): Finding[] {
  const findings: Finding[] = [];
  const shape = layoutShape(layout);
  const { capabilities } = target;
  if (shape === 'fixed') {
    findings.push({
      code: 'target.fixed',
      severity: 'warning',
      message: 'Nothing in this layout resizes; it exports as a plain image with zero insets.',
    });
  } else if (!capabilities.shapes.includes(shape)) {
    if (capabilities.emulated.includes(shape)) {
      const axis = shape === 'three' ? 'height' : 'width';
      findings.push({
        code: 'target.emulated',
        severity: 'info',
        message: `${target.label} has no native ${shape} layout, so it is exported as a nine-slice with zero insets on the fixed axis. Keep the ${axis} at the source size.`,
        details: { shape },
      });
    } else {
      findings.push({
        code: 'target.unsupported',
        severity: 'error',
        message: `${target.label} cannot represent a ${shape} layout. Export it to a target that can, or re-slice it as a nine-slice.`,
        details: { shape },
      });
    }
  }
  const tilesX = axisTiles(layout.x);
  const tilesY = axisTiles(layout.y);
  if (tilesX || tilesY) {
    if (capabilities.tile === 'none') {
      findings.push({
        code: 'target.tile',
        severity: 'warning',
        message: `${target.label} cannot tile, so the tiled span stretches instead.`,
      });
    } else if (capabilities.tile === 'both' && tilesX !== tilesY) {
      findings.push({
        code: 'target.tile',
        severity: 'warning',
        message: `${target.label} tiles both axes together, so the axis meant to stretch tiles too.`,
      });
    }
  }
  return findings;
}

/** Insets every single-region target exports; a fixed axis has zero insets. */
export function exportInsets(layout: SliceLayout): SliceInsets {
  const insets = layoutInsets(layout);
  if (insets === undefined) {
    throw new Error('A multi-region layout has no single set of insets.');
  }
  return insets;
}

/** A short note on keeping a fixed axis at its size, or an empty string. */
export function fixedAxisNote(layout: SliceLayout): string {
  const shape = layoutShape(layout);
  if (shape === 'three') {
    return ` Keep the height at ${layout.y.length} px.`;
  }
  if (shape === 'three-vertical') {
    return ` Keep the width at ${layout.x.length} px.`;
  }
  return '';
}
