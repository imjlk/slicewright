import typia from 'typia';

import type {
  BrowserMeasurement,
  BrowserRenderingEnvironment,
  BrowserSnapshot,
} from './browser.js';
import type { Rect } from './raster.js';

export function checkedMeasurement(value: BrowserMeasurement): BrowserMeasurement {
  typia.assert<BrowserMeasurement>(value);
  if (value.focus?.visible === true && !value.focus.focused) {
    throw new TypeError('Visible focus requires focused state.');
  }
  checkedRect(value.bounds, 'Target bounds', true);
  if (value.contentBox !== undefined) {
    checkedRect(value.contentBox, 'Content box');
  }
  for (const [name, content] of Object.entries(value.content ?? {})) {
    checkedRect(content.bounds, `Content ${name}`);
    for (const bounds of content.textBounds ?? []) {
      checkedRect(bounds, `Text bounds for ${name}`);
    }
  }
  return structuredClone(value);
}

export function checkedSnapshot(value: BrowserSnapshot): void {
  typia.assert<BrowserSnapshot>(value);
  checkedRendering(value.rendering);
  checkedMeasurement(value.measurement);
  checkedRect(value.clip, 'Snapshot clip', true);
  const { width, height, data } = value.raster;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
    !Number.isSafeInteger(width * height * 4) || data.length !== width * height * 4 ||
    value.clip.width !== width || value.clip.height !== height) {
    throw new RangeError('Snapshot raster dimensions, clip, and RGBA byte count must agree.');
  }
}

export function checkedRect(rect: Rect, name: string, positive = false): void {
  if (![rect.x, rect.y, rect.width, rect.height, rect.x + rect.width, rect.y + rect.height].every(Number.isFinite) ||
    rect.width < 0 || rect.height < 0 || (positive && (rect.width === 0 || rect.height === 0))) {
    throw new RangeError(
      `${name} must be finite with ${positive ? 'positive' : 'nonnegative'} dimensions.`,
    );
  }
}

/**
 * @evidence docs/spec.md#browser-failure-context Validates optional rendering context without making it an implicit pixel-match requirement or inventing absent identity.
 * @evidenceReview docs/spec.md#browser-failure-context #0d2038e Read the optional metadata contract and finite positive viewport/DPR, nonblank identity and string-label checks; checked the passing unit and three-engine installed consumer results.
 */
export function checkedRendering(value: BrowserRenderingEnvironment | undefined): void {
  typia.assert<BrowserRenderingEnvironment | undefined>(value);
  if (value === undefined) {
    return;
  }
  if (![value.viewport.width, value.viewport.height, value.deviceScaleFactor].every(
    (number) => Number.isFinite(number) && number > 0,
  )) {
    throw new RangeError('Rendering viewport and device scale factor must be finite and positive.');
  }
  if (value.runnerPlatform.trim() === '' || (value.browser !== undefined &&
    (value.browser.name.trim() === '' || value.browser.version.trim() === ''))) {
    throw new TypeError('Recorded rendering identity must not be blank.');
  }
}
