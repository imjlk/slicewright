// Lays out every manifest entry's exported CSS class at the same sizes the
// Phaser check uses, so a script can compare the browser's border-image
// rendering with slicewright's own renderer.
const params = new URLSearchParams(location.search);
const manifestUrl = new URL(params.get('manifest') ?? '../real/manifest.json', location.href);
const gap = 16;
const labelWidth = 150;

const manifest = await (await fetch(manifestUrl)).json();
const report = [];
let y = gap;
for (const entry of manifest.entries.filter((item) => item.css !== undefined)) {
  const atlasUrl = new URL(entry.atlas, manifestUrl);
  const atlas = await (await fetch(atlasUrl)).json();
  const frame = entry.frame === undefined ? Object.values(atlas.frames)[0] : atlas.frames[entry.frame];
  const cssUrl = new URL(entry.css, manifestUrl);
  const css = await (await fetch(cssUrl)).text();
  // A packed stylesheet has a class per frame, named after it.
  const className = entry.frame ?? /\.([A-Za-z_][A-Za-z0-9_-]*)\s*\{/.exec(css)[1];
  // Border images load lazily; decode every image first so the cells paint at once.
  for (const [, path] of css.matchAll(/url\("([^"]+)"\)/g)) {
    const preload = new Image();
    preload.src = new URL(path, cssUrl).href;
    await preload.decode();
  }
  const style = document.createElement('style');
  // Resolve the image against the CSS file, as a linked stylesheet would.
  style.textContent = css.replace(/url\("([^"]+)"\)/g, (_, path) => `url("${new URL(path, cssUrl).href}")`);
  document.head.append(style);

  const label = document.createElement('div');
  label.className = 'slicewright-label';
  label.style.left = `${gap}px`;
  label.style.top = `${y}px`;
  label.textContent = entry.label;
  document.body.append(label);

  let x = labelWidth;
  let rowHeight = 0;
  for (const [size, w, h] of sizesFor(frame)) {
    const cell = document.createElement('div');
    cell.className = `slicewright-cell ${className}`;
    cell.style.left = `${x}px`;
    cell.style.top = `${y}px`;
    cell.style.width = `${w}px`;
    cell.style.height = `${h}px`;
    document.body.append(cell);
    report.push({ entry: entry.label, image: new URL(atlas.meta.image, atlasUrl).pathname, size, at: [x, y], rendered: [w, h], borders: frame.scale9Borders, frame: frame.frame, shape: frame.slicewright?.shape, tile: entry.tile ?? '' });
    x += w + gap;
    rowHeight = Math.max(rowHeight, h);
  }
  y += rowHeight + gap;
}
document.body.style.height = `${y}px`;
await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
window.slicewrightCssReport = report;

function sizesFor(frame) {
  const { w, h } = frame.frame;
  const b = frame.scale9Borders;
  const three = b.y === 0 && b.h === h;
  // Only the explicit marker means a fixed width; full-width borders alone do not.
  const vertical = frame.slicewright?.shape === 'three-vertical';
  const sizes = [['frame', w, h], ['min', vertical ? w : Math.max(1, w - b.w), three ? h : Math.max(1, h - b.h)]];
  if (!vertical) {
    sizes.push(['wide', Math.round(w * 2.5), h]);
  }
  if (!three) {
    sizes.push(['tall', w, Math.round(h * 2.5)]);
  }
  sizes.push(['double', vertical ? w : w * 2, three ? h : h * 2]);
  return sizes;
}
