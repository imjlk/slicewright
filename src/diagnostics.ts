import type { Finding } from './inspect.js';
import { createRaster, pixelOffset, type Raster, type Rect } from './raster.js';

/** Where a finding is, in source pixels. */
export interface DiagnosticMarker {
  readonly code: string;
  /** `line` marks whole columns or rows, `pixel` single pixels. */
  readonly kind: 'line' | 'pixel';
  readonly rects: readonly Rect[];
}

const lineColor = [255, 32, 32, 255] as const;
const pixelColor = [255, 220, 0, 255] as const;
/** Alpha at or above this counts as opaque, as interior-alpha inspection counts it. */
const opaqueAlpha = 224;

/**
 * The places a report's findings point at: the first differing pair of lines
 * in a stretch span, the two ends of a tiled span that meet at each seam, and
 * the partly transparent pixels inside the interior region.
 *
 * @evidence docs/spec.md#preview-diagnostics Locates nonuniform line pairs, tiled-span seams, and partly transparent interior pixels from the findings' details.
 * @evidenceReview docs/spec.md#preview-diagnostics #bb4d822 Checked this code against the section line by line and ran drawsDiagnostics green with pnpm test.
 */
export function diagnosticMarkers(
  source: Raster,
  findings: readonly Finding[],
): DiagnosticMarker[] {
  const markers: DiagnosticMarker[] = [];
  const line = (axis: unknown, index: number): Rect | undefined => {
    if (!Number.isInteger(index) || index < 0) {
      return undefined;
    }
    if (axis === 'x' && index < source.width) {
      return { x: index, y: 0, width: 1, height: source.height };
    }
    if (axis === 'y' && index < source.height) {
      return { x: 0, y: index, width: source.width, height: 1 };
    }
    return undefined;
  };
  for (const finding of findings) {
    const details = finding.details ?? {};
    if (/^stretch\.[xy]\.nonuniform$/.test(finding.code)) {
      const pair = Array.isArray(details['pair']) ? (details['pair'] as unknown[]) : [];
      const rects = pair.map((index) => line(details['axis'], Number(index)));
      pushMarker(markers, finding.code, 'line', rects);
    } else if (/^tile\.[xy]\.seam$/.test(finding.code)) {
      const span = details['span'] as { start?: unknown; end?: unknown } | undefined;
      const rects = [
        line(details['axis'], Number(span?.start)),
        line(details['axis'], Number(span?.end) - 1),
      ];
      pushMarker(markers, finding.code, 'line', rects);
    } else if (finding.code === 'alpha.interior') {
      const region = details['region'] as Partial<Rect> | undefined;
      pushMarker(markers, finding.code, 'pixel', partialPixels(source, region));
    }
  }
  return markers;
}

/**
 * The source dimmed toward gray, with marked lines in red and marked pixels in
 * yellow drawn over it, each marker over the ones before.
 *
 * @evidence docs/spec.md#preview-diagnostics Dims the source and draws line markers red and pixel markers yellow.
 * @evidenceReview docs/spec.md#preview-diagnostics #bb4d822 Checked this code against the section line by line and ran drawsDiagnostics green with pnpm test.
 */
export function renderDiagnostics(source: Raster, markers: readonly DiagnosticMarker[]): Raster {
  const out = createRaster(source.width, source.height);
  for (let index = 0; index < source.data.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      out.data[index + channel] = Math.round(((source.data[index + channel] ?? 0) + 128) / 2);
    }
    out.data[index + 3] = Math.max(source.data[index + 3] ?? 0, 96);
  }
  for (const marker of markers) {
    const color = marker.kind === 'line' ? lineColor : pixelColor;
    for (const rect of marker.rects) {
      for (let y = rect.y; y < rect.y + rect.height; y += 1) {
        for (let x = rect.x; x < rect.x + rect.width; x += 1) {
          out.data.set(color, pixelOffset(out, x, y));
        }
      }
    }
  }
  return out;
}

function pushMarker(
  markers: DiagnosticMarker[],
  code: string,
  kind: DiagnosticMarker['kind'],
  rects: ReadonlyArray<Rect | undefined>,
): void {
  const found = rects.filter((rect): rect is Rect => rect !== undefined);
  if (found.length > 0) {
    markers.push({ code, kind, rects: found });
  }
}

function partialPixels(source: Raster, region: Partial<Rect> | undefined): Rect[] {
  const { x = 0, y = 0, width = 0, height = 0 } = region ?? {};
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(source.width, x + width);
  const y1 = Math.min(source.height, y + height);
  const pixels: Rect[] = [];
  for (let row = y0; row < y1; row += 1) {
    for (let column = x0; column < x1; column += 1) {
      const alpha = source.data[pixelOffset(source, column, row) + 3] ?? 0;
      if (alpha > 0 && alpha < opaqueAlpha) {
        pixels.push({ x: column, y: row, width: 1, height: 1 });
      }
    }
  }
  return pixels;
}
