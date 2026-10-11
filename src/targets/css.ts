import { axisTiles, layoutShape, type AxisLayout } from '../layout.js';
import { exportInsets } from './common.js';
import type { ExportInput, ExportResult, SliceTarget } from './types.js';

export const cssTarget: SliceTarget = {
  id: 'css',
  label: 'CSS border-image',
  capabilities: { shapes: ['nine', 'three', 'three-vertical'], emulated: [], tile: 'per-axis' },
  exportLayout: exportCss,
};

/**
 * CSS `border-image`: the slices as `border-image-slice` with `fill`, matching
 * border widths, `round` for tiled axes, and the minimum or fixed size.
 *
 * @evidence docs/spec.md#css-border-image Writes the slice, width, repeat, and size declarations for the CSS target.
 * @evidenceReview docs/spec.md#css-border-image #c509052 Checked this code against the section line by line and ran exportsCssBorderImage green with pnpm test.
 */
export function exportCss({ name, imageRef, layout }: ExportInput): Omit<ExportResult, 'target' | 'findings'> {
  const insets = exportInsets(layout);
  const { top, right, bottom, left } = insets;
  const shape = layoutShape(layout);
  const repeat = (axis: AxisLayout): string => (axisTiles(axis) ? 'round' : 'stretch');
  const size =
    shape === 'three'
      ? [`  height: ${layout.y.length}px;`, `  min-width: ${left + right}px;`]
      : shape === 'three-vertical'
        ? [`  width: ${layout.x.length}px;`, `  min-height: ${top + bottom}px;`]
        : [`  min-width: ${left + right}px;`, `  min-height: ${top + bottom}px;`];
  const className = cssIdentifier(name);
  const css = [
    `/* slicewright: ${name}, ${shape} */`,
    `.${className} {`,
    '  box-sizing: border-box;',
    '  border-style: solid;',
    `  border-width: ${top}px ${right}px ${bottom}px ${left}px;`,
    `  border-image-source: url("${imageRef}");`,
    `  border-image-slice: ${top} ${right} ${bottom} ${left} fill;`,
    `  border-image-repeat: ${repeat(layout.x)} ${repeat(layout.y)};`,
    ...size,
    '}',
    '',
  ].join('\n');
  return {
    files: [{ path: `${name}.css`, contents: css }],
    usage: `<link rel="stylesheet" href="${name}.css">\n<div class="${className}">…</div>`,
  };
}

/** Replaces characters a CSS class name cannot hold unescaped. */
export function cssIdentifier(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_-]/g, '-');
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `sw-${cleaned}`;
}
