// Trusted application code, not a slicewright manifest or detected layout.
export const assembly = {
  body: { width: 480, minWidth: 280, maxWidth: 720, minHeight: 219, z: 0 },
  ornament: {
    width: 160,
    anchor: { x: 0.5, y: 0 },
    origin: { x: 0.5, y: 1 },
    offset: { x: 0, y: 40 },
    z: 1,
  },
  // Total distances from the body edges, including the exported frame padding.
  content: { insets: { top: 108, right: 54, bottom: 111, left: 54 }, z: 2 },
  breakpoints: [{ maxBodyWidth: 420, actions: 'stack' }],
};

export function applyAssembly(root, config) {
  const { body, ornament, content } = config;
  root.style.width = `min(${Math.min(body.maxWidth, Math.max(body.minWidth, body.width))}px, 100%)`;
  root.style.minWidth = `${body.minWidth}px`;
  root.querySelector('.guild-panel').style.zIndex = body.z;
  const decoration = root.querySelector('.brooch');
  Object.assign(decoration.style, {
    width: `${ornament.width}px`,
    left: `calc(${ornament.anchor.x * 100}% + ${ornament.offset.x}px)`,
    top: `calc(${ornament.anchor.y * 100}% + ${ornament.offset.y}px)`,
    transform: `translate(${-ornament.origin.x * 100}%, ${-ornament.origin.y * 100}%)`,
    zIndex: ornament.z,
  });
  const { top, right, bottom, left } = content.insets;
  Object.assign(root.querySelector('.content-layer').style, {
    minHeight: `${body.minHeight}px`,
    padding: `${top}px ${right}px ${bottom}px ${left}px`,
    zIndex: content.z,
  });
  const width = root.getBoundingClientRect().width;
  root.classList.toggle('stack-actions', config.breakpoints.some((point) =>
    width <= point.maxBodyWidth && point.actions === 'stack'));
}
