import { axisTiles, layoutShape, type AxisLayout } from '../layout.js';
import { exportInsets, urlFromPath } from './common.js';
import type { ExportInput, ExportResult, SliceTarget } from './types.js';

export const cssTarget: SliceTarget = {
  id: 'css',
  label: 'CSS border-image',
  status: 'verified',
  capabilities: {
    shapes: ['nine', 'three', 'three-vertical'],
    emulated: [],
    tile: 'per-axis',
    tileCount: 'round',
  },
  outputs: (name) => [`${name}.css`],
  exportLayout: exportCss,
};

/**
 * CSS `border-image`: the slices as `border-image-slice` with `fill`, matching
 * border widths, `round` for tiled axes, and the minimum or fixed size.
 *
 * @evidence docs/spec.md#css-border-image Writes the slice, width, repeat, and size declarations for the CSS target.
 * @evidenceReview docs/spec.md#css-border-image #9ee8b1e Checked this code against the section line by line and ran exportsCssBorderImage green with pnpm test.
 */
export function exportCss({
  name,
  imageRef,
  layout,
  loaderPaths,
}: ExportInput): Omit<ExportResult, 'target' | 'findings'> {
  const insets = exportInsets(layout);
  const { top, right, bottom, left } = insets;
  const padding = layout.content ?? insets;
  const shape = layoutShape(layout);
  const repeat = (axis: AxisLayout): string => (axisTiles(axis) ? 'round' : 'stretch');
  const size =
    shape === 'three'
      ? [
          `  height: ${layout.y.length}px;`,
          `  min-width: ${Math.max(left + right, padding.left + padding.right)}px;`,
        ]
      : shape === 'three-vertical'
        ? [
            `  width: ${layout.x.length}px;`,
            `  min-height: ${Math.max(top + bottom, padding.top + padding.bottom)}px;`,
          ]
        : [
            `  min-width: ${Math.max(left + right, padding.left + padding.right)}px;`,
            `  min-height: ${Math.max(top + bottom, padding.top + padding.bottom)}px;`,
          ];
  const className = cssIdentifier(name);
  const directory = loaderPaths?.directory ?? '';
  const stylesheetUrl = urlFromPath(
    directory === '' || directory === '.'
      ? `${name}.css`
      : `${directory.replace(/\/+$/, '')}/${name}.css`,
  );
  const css = [
    // The name is caller data; a */ inside it would end the comment early.
    `/* slicewright: ${name.replaceAll('*/', '* /')}, ${shape} */`,
    `.${className} {`,
    '  box-sizing: border-box;',
    '  border-style: solid;',
    // border-width sets the content box; border-image-width keeps the art at its slices.
    `  border-width: ${padding.top}px ${padding.right}px ${padding.bottom}px ${padding.left}px;`,
    `  border-image-source: url(${cssString(urlFromPath(imageRef))});`,
    `  border-image-slice: ${top} ${right} ${bottom} ${left} fill;`,
    `  border-image-width: ${top}px ${right}px ${bottom}px ${left}px;`,
    `  border-image-repeat: ${repeat(layout.x)} ${repeat(layout.y)};`,
    ...size,
    '}',
    '',
  ].join('\n');
  return {
    files: [{ path: `${name}.css`, contents: css }],
    usage: `<link rel="stylesheet" href="${htmlAttribute(stylesheetUrl)}">\n<div class="${className}">…</div>`,
  };
}

/** Replaces characters a CSS class name cannot hold unescaped. */
export function cssIdentifier(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_-]/g, '-');
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `sw-${cleaned}`;
}

/** A double-quoted CSS string: backslashes, quotes, and line breaks escaped. */
export function cssString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ')}"`;
}

function htmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
