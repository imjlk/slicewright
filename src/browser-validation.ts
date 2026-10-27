import typia from 'typia';

import type { BrowserMeasurement, BrowserSnapshot } from './browser.js';
import type { Rect } from './raster.js';

export function checkedMeasurement(value: BrowserMeasurement): BrowserMeasurement {
  typia.assert<BrowserMeasurement>(value);
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
