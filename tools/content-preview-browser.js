// Loaded by engine-check only. Keep measurements in the browser: DOM boxes
// alone miss text which paints outside a fixed-height or narrow container.
globalThis.slicewrightMeasureContent = async () => {
  const images = await Promise.all([...document.images].map(async (image) => {
    let decoded = true;
    try {
      await image.decode();
    } catch {
      decoded = false;
    }
    return { name: image.className, decoded, width: image.naturalWidth, height: image.naturalHeight };
  }));
  // Viewport and content changes need a paint before screenshotting the result.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const rect = (box) => ({
    x: box.x, y: box.y, width: box.width, height: box.height,
  });
  const box = (selector) => rect(document.querySelector(selector).getBoundingClientRect());
  const style = (selector) => getComputedStyle(document.querySelector(selector));
  return {
    images,
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    scrollY,
    stage: box('.stage'),
    frame: box('.guild-panel'),
    content: box('.quest-content'),
    ornament: box('.brooch'),
    fontSize: Number.parseFloat(style('#quest-copy').fontSize),
    z: ['.guild-panel', '.brooch', '.content-layer'].map((selector) => Number(style(selector).zIndex)),
    ornamentPointerEvents: style('.brooch').pointerEvents,
    texts: [...document.querySelectorAll('[data-content-text]')].map((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return {
        name: element.id || element.className,
        box: rect(element.getBoundingClientRect()),
        lines: [...range.getClientRects()].map(rect),
      };
    }),
    actions: [...document.querySelectorAll('.actions button')].map((element) =>
      rect(element.getBoundingClientRect()),
    ),
  };
};

globalThis.slicewrightSetContentWidth = (width) => {
  const input = document.querySelector('#panel-width');
  input.value = String(width);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

globalThis.slicewrightSetBroochSource = (source) => {
  document.querySelector('.brooch').src = source;
};

globalThis.slicewrightContentAssembly = async (config) => {
  const module = await import('/examples/content-preview/assembly.js');
  if (config) {
    // Change the application's trusted config too, so resize events (including
    // a full-page screenshot) keep using the values under test.
    Object.assign(module.assembly, config);
    globalThis.slicewrightSetContentWidth(config.body.width);
  }
  return module.assembly;
};

// Put the actual decorative image over a control to prove pointer pass-through.
// Its ordinary placement deliberately avoids controls, so ordinary clicks alone
// would not detect a missing pointer-events rule.
globalThis.slicewrightProbeOrnament = (intercept) => {
  const button = document.querySelector('#accept');
  button.scrollIntoView({ block: 'center' });
  const target = button.getBoundingClientRect();
  const root = document.querySelector('.composition').getBoundingClientRect();
  Object.assign(document.querySelector('.brooch').style, {
    left: `${target.x - root.x}px`, top: `${target.y - root.y}px`,
    width: `${target.width}px`, height: `${target.height}px`,
    transform: 'none', zIndex: 10, pointerEvents: intercept ? 'auto' : 'none',
  });
  return { x: target.x + target.width / 2, y: target.y + target.height / 2 };
};
