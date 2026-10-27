import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { checkSnapshot, writeBrowserArtifacts } from 'slicewright/browser';

// This consumer policy accepts tiny native glyph-raster differences inside
// reported text rectangles. A genuine text-region pixel change within these
// bounds is also allowed; persistence bytes and all other scenarios stay exact.
export const freshBaselinePixels = Object.freeze({ mean: 0.01, p99: 0, max: 32 });

function textPixelMask(reference) {
  const { width, height } = reference.raster;
  const mask = new Uint8Array(width * height);
  for (const content of Object.values(reference.measurement.content ?? {})) {
    for (const bounds of content.textBounds ?? []) {
      if (bounds.width === 0 || bounds.height === 0) continue;
      // Text bounds and clip share viewport CSS coordinates. Include every
      // raster pixel touched by a fractional text rectangle, clipped to image.
      const left = Math.min(width, Math.max(0, Math.floor(bounds.x - reference.clip.x)));
      const top = Math.min(height, Math.max(0, Math.floor(bounds.y - reference.clip.y)));
      const right = Math.max(0, Math.min(width, Math.ceil(bounds.x + bounds.width - reference.clip.x)));
      const bottom = Math.max(0, Math.min(height, Math.ceil(bounds.y + bounds.height - reference.clip.y)));
      if (right <= left || bottom <= top) continue;
      for (let y = top; y < bottom; y++) mask.fill(1, y * width + left, y * width + right);
    }
  }
  return mask;
}

export function compareFreshBaseline(actual, reference) {
  const checked = checkSnapshot(actual, { reference, pixels: freshBaselinePixels });
  const policy = {
    pixels: freshBaselinePixels,
    measurementEqual: isDeepStrictEqual(actual.measurement, reference.measurement),
    clipEqual: isDeepStrictEqual(actual.clip, reference.clip),
    changedAlphaPixels: 0,
    changedOutsideTextPixels: 0,
  };
  if (actual.raster.width === reference.raster.width && actual.raster.height === reference.raster.height) {
    const mask = textPixelMask(reference);
    for (let pixel = 0; pixel < mask.length; pixel++) {
      const offset = pixel * 4;
      if (actual.raster.data[offset + 3] !== reference.raster.data[offset + 3]) policy.changedAlphaPixels++;
      if (!mask[pixel] && actual.raster.data.subarray(offset, offset + 4).some(
        (value, channel) => value !== reference.raster.data[offset + channel],
      )) policy.changedOutsideTextPixels++;
    }
  }
  const findings = [...checked.findings];
  for (const [code, valid, message] of [
    ['consumer.baseline-measurement', policy.measurementEqual, 'Baseline measurements must remain exactly equal.'],
    ['consumer.baseline-clip', policy.clipEqual, 'Baseline clips must remain exactly equal.'],
    ['consumer.baseline-alpha', policy.changedAlphaPixels === 0, 'Baseline alpha must remain byte-exact.'],
    ['consumer.baseline-outside-text', policy.changedOutsideTextPixels === 0, 'Pixels outside reported text bounds must remain byte-exact.'],
  ]) {
    if (!valid) findings.push({ code, severity: 'error', message });
  }
  return { report: { ...checked, ok: findings.length === 0, findings }, policy };
}

export async function writeFreshBaselineArtifacts(directory, actual, reference, result) {
  await writeBrowserArtifacts(directory, { actual, reference, report: result.report });
  await writeFile(join(directory, 'policy.json'), `${JSON.stringify(result.policy, null, 2)}\n`);
}

export function assertFreshBaseline(actual, reference, result) {
  deepStrictEqual(actual.measurement, reference.measurement, 'Fresh baseline measurements must match exactly.');
  deepStrictEqual(actual.clip, reference.clip, 'Fresh baseline clips must match exactly.');
  strictEqual(result.policy.changedAlphaPixels, 0, 'Fresh baseline alpha must match exactly.');
  strictEqual(result.policy.changedOutsideTextPixels, 0, 'Fresh baseline pixels outside text must match exactly.');
  ok(result.report.ok, 'Fresh baseline text pixels must satisfy the explicit consumer tolerance.');
}

export async function verifyFreshBaselineControls(directory) {
  const bounds = { x: 13, y: 19, width: 64, height: 64 };
  const data = new Uint8Array(64 * 64 * 4);
  for (let offset = 0; offset < data.length; offset += 4) data.set([96, 96, 96, 255], offset);
  const reference = {
    measurement: {
      bounds,
      content: {
        label: {
          bounds: { x: 21, y: 29, width: 20, height: 10 }, text: 'Guard',
          textBounds: [{ x: 21.25, y: 29.5, width: 12.5, height: 7.25 }],
        },
      },
    },
    clip: bounds,
    raster: { width: 64, height: 64, data },
  };
  const change = (snapshot, x, y, channel, delta) => {
    snapshot.raster.data[(y * 64 + x) * 4 + channel] += delta;
  };
  const controls = [
    { name: 'bounded-text', accepted: true, mutate: (snapshot) => change(snapshot, 8, 10, 0, 32) },
    { name: 'text-max', accepted: false, code: 'browser.pixels', mutate: (snapshot) => change(snapshot, 8, 10, 0, 33) },
    { name: 'text-aggregate', accepted: false, code: 'browser.pixels', mutate: (snapshot) => {
      change(snapshot, 8, 10, 0, 32); change(snapshot, 9, 10, 0, 32);
    } },
    { name: 'outside-text', accepted: false, code: 'consumer.baseline-outside-text', mutate: (snapshot) => change(snapshot, 7, 10, 0, 1) },
    { name: 'alpha', accepted: false, code: 'consumer.baseline-alpha', mutate: (snapshot) => change(snapshot, 8, 10, 3, -1) },
  ];
  for (const control of controls) {
    const actual = structuredClone(reference);
    control.mutate(actual);
    const result = compareFreshBaseline(actual, reference);
    await writeFreshBaselineArtifacts(join(directory, control.name), actual, reference, result);
    strictEqual(result.report.ok, control.accepted, `${control.name}: enforce the fresh-render policy boundary.`);
    if (control.code) ok(result.report.findings.some((finding) => finding.code === control.code));
    if (control.name === 'text-max') {
      ok(result.report.pixels.mean <= freshBaselinePixels.mean && result.report.pixels.p99 === 0);
      strictEqual(result.report.pixels.max, 33);
    }
    if (control.name === 'text-aggregate') {
      ok(result.report.pixels.mean > freshBaselinePixels.mean);
      strictEqual(result.report.pixels.p99, 0);
      strictEqual(result.report.pixels.max, 32);
    }
    if (control.name === 'outside-text' || control.name === 'alpha') {
      ok(checkSnapshot(actual, { reference, pixels: freshBaselinePixels }).ok,
        `${control.name}: exact guards must reject a difference the numeric tolerance alone would accept.`);
    }
  }
  return controls.length;
}
