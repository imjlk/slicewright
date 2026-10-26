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
  return {
    images,
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    stage: box('.stage'),
    frame: box('.guild-panel'),
    content: box('.quest-content'),
    ornament: box('.brooch'),
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
