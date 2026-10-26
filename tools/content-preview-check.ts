import { extname } from 'node:path';

import type { Page } from 'playwright-core';

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface Measurement {
  readonly images: readonly { name: string; decoded: boolean; width: number; height: number }[];
  readonly viewportWidth: number;
  readonly documentWidth: number;
  readonly stage: Box;
  readonly frame: Box;
  readonly content: Box;
  readonly ornament: Box;
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

function problems(measurement: Measurement): string[] {
  const { content, frame, ornament, texts, actions } = measurement;
  const found: string[] = [];
  if (measurement.images.length === 0 || measurement.images.some((image) =>
    !image.decoded || image.width === 0 || image.height === 0)) {
    found.push('content image failed to decode');
  }
  if (measurement.documentWidth > measurement.viewportWidth) {
    found.push('document overflows the viewport');
  }
  if (!contains(frame, content)) {
    found.push('content exceeds frame');
  }
  if (overlaps(ornament, content)) {
    found.push('ornament overlaps content');
  }
  if (Math.abs(ornament.width - 160) > 1 || Math.abs(ornament.height - 160 * 76 / 180) > 1) {
    found.push('ornament was stretched');
  }
  if (Math.abs(ornament.x + ornament.width / 2 - frame.x - frame.width / 2) > 1 ||
    Math.abs(ornament.y + ornament.height - frame.y - 40) > 1) {
    found.push('ornament moved from its authored anchor');
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
  if (actions.length !== 2 || actions.some((action) => !contains(content, action)) ||
    (actions[0] !== undefined && actions[1] !== undefined && overlaps(actions[0], actions[1]))) {
    found.push('actions overlap or exceed content');
  }
  return found;
}

async function measure(page: Page): Promise<Measurement> {
  return page.evaluate(() => (globalThis as unknown as {
    slicewrightMeasureContent: () => Promise<Measurement>;
  }).slicewrightMeasureContent());
}

/** Exercises composed UI, beyond the engine check's unlabelled art cells. */
export async function checkContentPreview(page: Page, baseUrl: string, screenshot?: string): Promise<{
  cases: { viewport: number; width: number; scenario: string; height: number }[];
  failing: string[];
  negativeControls: string[];
}> {
  const failing: string[] = [];
  const cases: { viewport: number; width: number; scenario: string; height: number }[] = [];
  page.on('pageerror', (error) => failing.push(`browser: ${error.message}`));
  await page.goto(`${baseUrl}/examples/content-preview/index.html`);
  await page.locator('#quest-title').filter({ hasText: 'A light in the old wood' }).waitFor();
  await page.addScriptTag({ url: `${baseUrl}/tools/content-preview-browser.js` });
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
    let shortHeight = 0;
    for (const scenario of ['short', 'long', 'unbroken']) {
      await page.locator('#scenario').selectOption(scenario);
      const result = await measure(page);
      const name = `${viewport}px/${width}px/${scenario}`;
      failing.push(...problems(result).map((problem) => `${name}: ${problem}`));
      if (Math.abs(result.frame.width - Math.min(width, result.stage.width)) > 1) {
        failing.push(`${name}: width control did not resize the frame`);
      }
      if (scenario === 'short') {
        shortHeight = result.frame.height;
      } else if (scenario === 'long' && result.frame.height <= shortHeight + 40) {
        failing.push(`${name}: frame did not grow for long content`);
      }
      cases.push({ viewport, width, scenario, height: result.frame.height });
      if (scenario === 'long' && screenshot !== undefined) {
        const stem = screenshot.slice(0, screenshot.length - extname(screenshot).length);
        await page.screenshot({ path: `${stem}.content-${viewport}.png`, fullPage: true });
      }
    }
    for (const [button, message] of [
      ['#accept', 'Quest accepted. Your adventure begins!'],
      ['#later', 'The guild will keep a lantern lit for you.'],
    ] as const) {
      await page.locator(button).click();
      if (await page.locator('#quest-status').textContent() !== message) {
        failing.push(`${viewport}px: ${button} did not update live status`);
      }
      failing.push(
        ...problems(await measure(page)).map((problem) => `${viewport}px/status: ${problem}`),
      );
    }
  }
  // Prove the assertions catch real regressions: truncated prose, an ornament
  // on the text, and a broken image whose authored CSS dimensions still fit.
  await page.addStyleTag({
    content: '#quest-copy { height: 12px; overflow: hidden; } .brooch { bottom: auto; top: 80px; }',
  });
  await page.evaluate(() => (globalThis as unknown as {
    slicewrightSetBroochSource: (source: string) => void;
  }).slicewrightSetBroochSource('data:image/png;base64,invalid'));
  const broken = problems(await measure(page));
  const negativeControls = [
    'quest-copy text clips or overflows',
    'ornament overlaps content',
    'content image failed to decode',
  ].filter((problem) => broken.includes(problem));
  if (negativeControls.length !== 3) {
    failing.push('negative controls failed to detect clipping, ornament overlap, or broken art');
  }
  await page.close();
  return { cases, failing, negativeControls };
}
