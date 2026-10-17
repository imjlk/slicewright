import type { Finding } from '../inspect.js';
import { axisTiles, layoutInsets, layoutShape, type SliceLayout } from '../layout.js';
import type { SliceInsets } from '../slices.js';
import type { SliceTarget } from './types.js';

/**
 * Compares a layout with a target's capabilities: an unsupported shape and a
 * layout that resizes nothing are errors, an emulated shape is noted, tiling
 * the target cannot express or counts differently is a warning, and an
 * experimental target says so.
 *
 * @evidence docs/spec.md#targets Reports unsupported shapes as errors, emulation as info, and tiling gaps as warnings, from the declared capabilities.
 * @evidenceReview docs/spec.md#targets #01a5af9 Checked this code against the section line by line and ran checksTargetCapabilities green with pnpm test.
 */
export function capabilityFindings(target: SliceTarget, layout: SliceLayout): Finding[] {
  const findings: Finding[] = [];
  const shape = layoutShape(layout);
  const { capabilities } = target;
  findings.push(...(target.check?.(layout) ?? []));
  if (target.status === 'experimental') {
    findings.push({
      code: 'target.experimental',
      severity: 'info',
      message: `${target.label} output follows the engine's documented format but has not been run in ${target.label}. Reports and pull requests are welcome.`,
    });
  }
  if (shape === 'fixed') {
    findings.push({
      code: 'target.fixed',
      severity: 'error',
      message: 'Nothing in this layout resizes, and every target would stretch zero-inset art. Use the image as a plain sprite.',
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
    if (capabilities.tile !== 'none' && capabilities.tileCount === 'round') {
      findings.push({
        code: 'target.tile',
        severity: 'warning',
        message: `${target.label} uses the nearest whole number of tiles where the layout and Phaser round down, so a span between n + 0.5 and n + 1 tiles shows one more tile.`,
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

/**
 * A relative file path as a URL: each path component percent-encoded so
 * characters such as # and ? stay part of the name. A value that already has
 * a URL scheme is returned unchanged.
 */
export function urlFromPath(path: string): string {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)) {
    return path;
  }
  return path
    .split('/')
    .map((component) => encodeURIComponent(component))
    .join('/');
}
