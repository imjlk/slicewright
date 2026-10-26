import { extname } from 'node:path';

import { decode } from 'fast-png';
import type { Page } from 'playwright-core';

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface Assembly {
  body: { width: number; minWidth: number; maxWidth: number; minHeight: number; z: number };
  ornament: {
    width: number;
    anchor: { x: number; y: number };
    origin: { x: number; y: number };
    offset: { x: number; y: number };
    z: number;
  };
  content: { insets: { top: number; right: number; bottom: number; left: number }; z: number };
  breakpoints: { maxBodyWidth: number; actions: string }[];
}

interface Measurement {
  readonly images: readonly { name: string; decoded: boolean; width: number; height: number }[];
  readonly viewportWidth: number;
  readonly documentWidth: number;
  readonly scrollY: number;
  readonly stage: Box;
  readonly frame: Box;
  readonly content: Box;
  readonly ornament: Box;
  readonly fontSize: number;
  readonly z: readonly number[];
  readonly ornamentPointerEvents: string;
  readonly texts: readonly {
    readonly name: string;
    readonly box: Box;
    readonly lines: readonly Box[];
  }[];
  readonly actions: readonly Box[];
}

function contains(outer: Box, inner: Box): boolean {
  const slack = 1;
  return inner.x >= outer.x - slack && inner.y >= outer.y - slack &&
    inner.x + inner.width <= outer.x + outer.width + slack &&
    inner.y + inner.height <= outer.y + outer.height + slack;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width &&
    a.y < b.y + b.height && b.y < a.y + a.height;
}

function problems(measurement: Measurement, config: Assembly, scale = 1): string[] {
  const { content, frame, ornament, texts, actions } = measurement;
  const found: string[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;
  if (measurement.images.length === 0 || measurement.images.some((image) =>
    !image.decoded || image.width === 0 || image.height === 0)) {
    found.push('content image failed to decode');
  }
  if (measurement.documentWidth > measurement.viewportWidth) {
    found.push('document overflows the viewport');
  }
  const { body, ornament: placement, content: { insets } } = config;
  const requested = Math.min(body.maxWidth, Math.max(body.minWidth, body.width));
  if (!near(frame.width, Math.min(requested, measurement.stage.width))) {
    found.push('width control did not resize the frame');
  }
  if (frame.height < body.minHeight || !contains(frame, content)) {
    found.push('content exceeds frame');
  }
  if (!near(content.x - frame.x, insets.left) || !near(content.y - frame.y, insets.top) ||
    !near(frame.x + frame.width - content.x - content.width, insets.right) ||
    !near(frame.y + frame.height - content.y - content.height, insets.bottom)) {
    found.push('total content insets were not applied once');
  }
  if (overlaps(ornament, content)) {
    found.push('ornament overlaps content');
  }
  if (!near(ornament.width, placement.width) || !near(ornament.height, placement.width * 76 / 180)) {
    found.push('ornament was stretched');
  }
  if (!near(ornament.x + ornament.width * placement.origin.x,
    frame.x + frame.width * placement.anchor.x + placement.offset.x) ||
    !near(ornament.y + ornament.height * placement.origin.y,
      frame.y + frame.height * placement.anchor.y + placement.offset.y)) {
    found.push('ornament moved from its authored anchor');
  }
  if (!near(measurement.fontSize, 17 * scale)) {
    found.push('text scale was not applied');
  }
  if ([body.z, placement.z, config.content.z].some((z, index) => measurement.z[index] !== z)) {
    found.push('layer draw order differs from configuration');
  }
  if (measurement.ornamentPointerEvents !== 'none') {
    found.push('ornament captures pointer input');
  }
  for (const text of texts) {
    if (text.lines.length === 0 || !contains(content, text.box) ||
      text.lines.some((line) => !contains(content, line) || !contains(text.box, line))) {
      found.push(`${text.name} text clips or overflows`);
    }
  }
  for (let index = 0; index < texts.length; index += 1) {
    const current = texts[index];
    if (current !== undefined && texts.slice(index + 1).some((next) => overlaps(current.box, next.box))) {
      found.push(`${current.name} overlaps another text element`);
    }
  }
  const [first, second] = actions;
  if (actions.length !== 2 || actions.some((action) => !contains(content, action)) ||
    (first !== undefined && second !== undefined && overlaps(first, second))) {
    found.push('actions overlap or exceed content');
  }
  const stacked = scale === 2 || config.breakpoints.some((point) =>
    frame.width <= point.maxBodyWidth && point.actions === 'stack');
  if (first !== undefined && second !== undefined &&
    (stacked ? !near(first.x, second.x) || second.y < first.y + first.height : !near(first.y, second.y))) {
    found.push('action breakpoint was not applied');
  }
  return found;
}

async function measure(page: Page): Promise<Measurement> {
  return page.evaluate(() => (globalThis as unknown as {
    slicewrightMeasureContent: () => Promise<Measurement>;
  }).slicewrightMeasureContent());
}

async function configure(page: Page, config?: Assembly): Promise<Assembly> {
  return page.evaluate((value) => (globalThis as unknown as {
    slicewrightContentAssembly: (value?: Assembly) => Promise<Assembly>;
  }).slicewrightContentAssembly(value), config);
}

async function openPreview(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/examples/content-preview/index.html`);
  await page.locator('#quest-title').filter({ hasText: 'A light in the old wood' }).waitFor();
  await page.addScriptTag({ url: `${baseUrl}/tools/content-preview-browser.js` });
}

// Comparing decoded pixels catches CSS-hidden art even when the image decoded.
async function layerPaints(page: Page, selector: string, region?: Box): Promise<boolean> {
  const box = region ?? await page.locator(selector).boundingBox();
  if (box === null) {
    return false;
  }
  const scrollY = await page.evaluate(() => (globalThis as unknown as { scrollY: number }).scrollY);
  const clip = { ...box, y: box.y + scrollY, height: Math.min(box.height, 120) };
  const before = decode(await page.screenshot({ clip }));
  const hidden = await page.addStyleTag({
    content: `${selector} { visibility: hidden !important; }`,
  });
  const after = decode(await page.screenshot({ clip }));
  await hidden.evaluate((element) => element.remove());
  return before.data.some((value, index) => value !== after.data[index]);
}

async function protrusionPaints(page: Page): Promise<boolean> {
  const { frame, ornament } = await measure(page);
  const height = frame.y - ornament.y;
  if (height <= 1) {
    return false;
  }
  return layerPaints(page, '.brooch', { ...ornament, height });
}

async function checkActions(page: Page, config: Assembly, scale: number): Promise<string[]> {
  const failing: string[] = [];
  for (const [button, message] of [
    ['#accept', 'Quest accepted. Your adventure begins!'],
    ['#later', 'The guild will keep a lantern lit for you.'],
  ] as const) {
    await page.locator(button).click();
    if (await page.locator('#quest-status').textContent() !== message) {
      failing.push(`${button} did not update live status`);
    }
    failing.push(...problems(await measure(page), config, scale));
  }
  return failing;
}

/** Exercises composed UI, beyond the engine check's unlabelled art cells. */
export async function checkContentPreview(page: Page, baseUrl: string, screenshot?: string): Promise<{
  cases: { viewport: number; width: number; scenario: string; scale: number; height: number }[];
  failing: string[];
  negativeControls: string[];
}> {
  const failing: string[] = [];
  const cases: { viewport: number; width: number; scenario: string; scale: number; height: number }[] = [];
  const negativeControls: string[] = [];
  const stem = screenshot?.slice(0, screenshot.length - extname(screenshot).length);
  page.on('pageerror', (error) => failing.push(`browser: ${error.message}`));
  await openPreview(page, baseUrl);
  const defaults = await configure(page);
  for (const [viewport, width] of [
    [320, 280],
    [320, 720],
    [768, 480],
    [1024, 720],
  ] as const) {
    await page.setViewportSize({ width: viewport, height: 900 });
    await page.evaluate((size) => (globalThis as unknown as {
      slicewrightSetContentWidth: (value: number) => void;
    }).slicewrightSetContentWidth(size), width);
    const config = { ...defaults, body: { ...defaults.body, width } };
    let shortHeight = 0;
    const scenarios: [string, number][] = [
      ['short', 1],
      ['long', 1],
      ['unbroken', 1],
    ];
    if ((viewport === 320 && width === 280) || viewport === 1024) {
      scenarios.push(['korean', 1], ['korean', 2], ['long', 2]);
    }
    for (const [scenario, scale] of scenarios) {
      await page.locator('#scenario').selectOption(scenario);
      await page.locator('#large-text').setChecked(scale === 2);
      const result = await measure(page);
      const name = `${viewport}px/${width}px/${scenario}/${scale * 100}%`;
      failing.push(...problems(result, config, scale).map((problem) => `${name}: ${problem}`));
      if (scenario === 'short') {
        shortHeight = result.frame.height;
      }
      if (scenario === 'long' && result.frame.height <= shortHeight + 40) {
        failing.push(`${name}: frame did not grow for long content`);
      }
      cases.push({ viewport, width, scenario, scale, height: result.frame.height });
      if (stem !== undefined && (scenario === 'long' || scenario === 'korean')) {
        const path = scale === 1 && scenario === 'long'
          ? `${stem}.content-${viewport}`
          : `${stem}.content-${viewport}-${scenario}-${scale}`;
        await page.screenshot({ path: `${path}.png`, fullPage: true });
        if (scale === 2) {
          await page.screenshot({
            path: `${path}.top.png`,
            clip: {
              x: result.frame.x,
              y: result.frame.y + result.scrollY - 32,
              width: result.frame.width,
              height: 650,
            },
          });
          await page.locator('.actions').screenshot({ path: `${path}.actions.png` });
        }
      }
      if (scale === 2) {
        failing.push(
          ...(await checkActions(page, config, scale)).map((problem) => `${name}/status: ${problem}`),
        );
      }
    }
    await page.locator('#large-text').uncheck();
    failing.push(
      ...(await checkActions(page, config, 1)).map((problem) => `${viewport}px/status: ${problem}`),
    );
  }

  await page.setViewportSize({ width: 1024, height: 1400 });
  await openPreview(page, baseUrl);
  if (!await protrusionPaints(page)) {
    failing.push('default ornament protrusion did not paint visible pixels');
  }
  const variant: Assembly = {
    ...defaults,
    body: { ...defaults.body, width: 640, minHeight: 1200, z: 2 },
    ornament: {
      width: 144,
      anchor: { x: 0.25, y: 0 },
      origin: { x: 0.25, y: 0.75 },
      offset: { x: 8, y: 24 },
      z: 4,
    },
    content: { insets: { top: 120, right: 70, bottom: 120, left: 70 }, z: 6 },
    breakpoints: [{ maxBodyWidth: 700, actions: 'stack' }],
  };
  await configure(page, variant);
  const changed = await measure(page);
  if (Math.abs(changed.frame.height - variant.body.minHeight) > 1) {
    failing.push('changed configuration: short content did not honor the authored height floor');
  }
  failing.push(...problems(changed, variant).map((problem) => `changed configuration: ${problem}`));
  cases.push({
    viewport: 1024,
    width: 640,
    scenario: 'changed configuration',
    scale: 1,
    height: changed.frame.height,
  });
  if (stem !== undefined) {
    await page.screenshot({ path: `${stem}.content-config.png`, fullPage: true });
  }
  for (const selector of ['.guild-panel', '.brooch']) {
    if (!await layerPaints(page, selector)) {
      failing.push(`${selector}: art did not paint visible pixels`);
    }
  }
  if (!await protrusionPaints(page)) {
    failing.push('changed ornament protrusion did not paint visible pixels');
  }

  // Isolate each injected fault so one failure cannot mask another.
  for (const [css, expected] of [
    ['#quest-copy { height: 12px; overflow: hidden; }', 'quest-copy text clips or overflows'],
    ['.brooch { top: 150px !important; }', 'ornament overlaps content'],
    ['.quest-content { margin: 51px 45px 45px; }', 'total content insets were not applied once'],
  ] as const) {
    const fault = await page.addStyleTag({ content: css });
    if (problems(await measure(page), variant).includes(expected)) {
      negativeControls.push(expected);
    } else {
      failing.push(`negative control missed: ${expected}`);
    }
    await fault.evaluate((element) => element.remove());
    failing.push(
      ...problems(await measure(page), variant).map((problem) => `fault reset: ${problem}`),
    );
  }
  const invisible = await page.addStyleTag({ content: '.brooch { opacity: 0; }' });
  if (!await layerPaints(page, '.brooch')) {
    negativeControls.push('invisible ornament pixels');
  } else {
    failing.push('negative control missed: invisible ornament pixels');
  }
  await invisible.evaluate((element) => element.remove());
  failing.push(
    ...problems(await measure(page), variant).map((problem) => `visibility reset: ${problem}`),
  );
  const clipped = await page.addStyleTag({ content: '.composition { overflow: hidden; }' });
  if (!await protrusionPaints(page)) {
    negativeControls.push('clipped ornament protrusion');
  } else {
    failing.push('negative control missed: clipped ornament protrusion');
  }
  await clipped.evaluate((element) => element.remove());
  if (!await protrusionPaints(page)) {
    failing.push('ornament protrusion did not return after clipping reset');
  }
  await page.evaluate(() => (globalThis as unknown as {
    slicewrightSetBroochSource: (source: string) => void;
  }).slicewrightSetBroochSource('data:image/png;base64,invalid'));
  if (problems(await measure(page), variant).includes('content image failed to decode')) {
    negativeControls.push('content image failed to decode');
  } else {
    failing.push('negative control missed: broken art');
  }

  await openPreview(page, baseUrl);
  for (const intercept of [false, true]) {
    await page.locator('#scenario').selectOption('short');
    const before = await page.locator('#quest-status').textContent();
    const point = await page.evaluate((capture) => (globalThis as unknown as {
      slicewrightProbeOrnament: (value: boolean) => { x: number; y: number };
    }).slicewrightProbeOrnament(capture), intercept);
    await page.mouse.click(point.x, point.y);
    const after = await page.locator('#quest-status').textContent();
    if (!intercept && (after === before || after !== 'Quest accepted. Your adventure begins!')) {
      failing.push('decorative ornament intercepted the button click');
    }
    if (intercept && after === before) {
      negativeControls.push('ornament captures pointer input');
    } else if (intercept) {
      failing.push('negative control missed: pointer interception');
    }
  }
  await page.close();
  return { cases, failing, negativeControls };
}
