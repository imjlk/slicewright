import { isDeepStrictEqual } from 'node:util';

import typia from 'typia';

import { checkSnapshot, type BrowserReport, type BrowserSnapshot } from './browser.js';
import { checkedSnapshot } from './browser-validation.js';
import type { RasterDifference } from './raster.js';

export interface StabilityOptions {
  readonly duration?: number;
  readonly pixels?: RasterDifference;
}

export interface StabilityObservation {
  readonly report: BrowserReport;
  readonly reference: BrowserSnapshot;
  readonly pending: boolean;
}

/**
 * Tracks a sampled stable window against a copied anchor, never an adjacent frame.
 * @evidence docs/spec.md#browser-sustained-stability Checks pixels and explicit state against a fixed window anchor, resets on drift, and distinguishes pending observations from actual changes.
 * @evidenceReview docs/spec.md#browser-sustained-stability #81b4516 Read the window, copied anchor, time validation and explicit visual-state comparisons against the contract.
 */
export function createStabilityObserver(
  options: StabilityOptions = {},
): (actual: BrowserSnapshot, now: number) => StabilityObservation {
  typia.assert<StabilityOptions>(options);
  const duration = options.duration ?? 200;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new RangeError('UI stability duration must be finite and positive.');
  }
  const pixels = structuredClone(options.pixels ?? { mean: 0, p99: 0, max: 0 });
  if (Object.values(pixels).some((value) => !Number.isFinite(value) || value < 0)) {
    throw new RangeError('UI stability pixel tolerances must be finite and nonnegative.');
  }
  let anchor: BrowserSnapshot | undefined;
  let since = 0;
  let lastTime = -Infinity;
  return (actual, now) => {
    checkedSnapshot(actual);
    if (!Number.isFinite(now) || now < lastTime) {
      throw new RangeError('UI stability observations require finite monotonic timestamps.');
    }
    lastTime = now;
    const first = anchor === undefined;
    if (anchor === undefined) {
      anchor = structuredClone(actual);
      since = now;
    }
    const reference = anchor;
    const comparison = checkSnapshot(actual, { reference, pixels });
    const findings = [...comparison.findings];
    if (!isDeepStrictEqual(visualState(actual), visualState(reference))) {
      findings.push({
        severity: 'error',
        code: 'browser.stability-state',
        message: 'Absolute geometry, content, focus, or viewport/DPR changed during the stable window.',
      });
    }
    const changed = findings.length > 0;
    const pending = !changed && (first || now - since < duration);
    if (pending) {
      findings.push({
        severity: 'error',
        code: 'browser.stability-pending',
        message: 'More observations are required to establish the requested stable duration.',
        details: { elapsed: now - since, duration },
      });
    }
    if (changed) {
      anchor = structuredClone(actual);
      since = now;
    }
    return {
      report: { ...comparison, ok: findings.length === 0, findings },
      // Callers may retain or mutate an artifact reference without changing the window.
      reference: structuredClone(reference),
      pending,
    };
  };
}

function visualState(snapshot: BrowserSnapshot): object {
  return {
    clip: snapshot.clip,
    measurement: snapshot.measurement,
    viewport: snapshot.rendering?.viewport,
    deviceScaleFactor: snapshot.rendering?.deviceScaleFactor,
  };
}
