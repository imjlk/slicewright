import { deepStrictEqual, ok } from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkSnapshot, domTarget, regionTarget, writeBrowserArtifacts } from 'slicewright/browser';

// Real keyboard input drives both renderers. Instrumentation only reads state.
export async function runKeyboardScenario(page, renderer, fault, output, matcher) {
  await page.setContent(await readFile(new URL('./focus.html', import.meta.url), 'utf8'));
  await page.evaluate(({ renderer, fault }) => window.installFocusFixture(renderer, fault), { renderer, fault });
  const targets = [0, 1, 2].map((index) => renderer === 'dom'
    ? domTarget(page, { root: page.locator(`#control-${index}`) })
    : regionTarget(page, { measure: () => page.evaluate((index) => window.focusFixture.measure(index), index) }));
  const findings = [];
  async function verify(step, index, checks) {
    const target = typeof index === 'number' ? targets[index] : index;
    const actual = await target.capture();
    const report = checkSnapshot(actual, checks);
    await writeBrowserArtifacts(join(output, step), {
      actual, report, ...(checks.changedFrom ? { changedFrom: checks.changedFrom } : {}),
    });
    findings.push(...report.findings.map(({ code }) => ({ step, code })));
    if (matcher) await matcher(target, checks);
  }
  // Isolate the indicator from glyph rasterization and unrelated content changes.
  const ring = regionTarget(page, { measure: async () => {
    const { bounds, focus } = await targets[0].measure();
    return { bounds: { ...bounds, width: 8 }, focus };
  } });
  await page.locator('#before').focus();
  const before = await ring.capture();
  await verify('initial', 0, { focus: { focused: false, visible: false } });
  await page.keyboard.press('Tab');
  await verify('first-focus', 0, { focus: { focused: true, visible: true } });
  await verify('focus-ring', ring, { focus: { focused: true, visible: true }, changedFrom: before });
  await page.keyboard.press('Tab');
  await verify('skip-disabled', 2, { focus: { focused: true, visible: true } });
  await verify('disabled-unfocused', 1, { focus: { focused: false, visible: false } });
  await page.keyboard.press('Shift+Tab');
  await verify('reverse', 0, { focus: { focused: true, visible: true } });
  await page.keyboard.press('Enter');
  if (JSON.stringify(await page.evaluate(() => window.focusFixture.counts())) !== '[1,0,0]') {
    findings.push({ step: 'enter', code: 'consumer.activation-count' });
  }
  await page.keyboard.press('Space');
  if (JSON.stringify(await page.evaluate(() => window.focusFixture.counts())) !== '[2,0,0]') {
    findings.push({ step: 'space', code: 'consumer.activation-count' });
  }
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await verify('leave', 2, { focus: { focused: false, visible: false } });
  await page.keyboard.press('Shift+Tab');
  await verify('return', 2, { focus: { focused: true, visible: true } });
  const expected = { order: 'browser.focus', paint: 'browser.pixels-unchanged', duplicate: 'consumer.activation-count' };
  if (fault === 'none') deepStrictEqual(findings, [], `${renderer}: healthy keyboard flow`);
  else ok(findings.some(({ code }) => code === expected[fault]), `${renderer}/${fault}: must reject its injected fault`);
  return { renderer, fault, rejected: findings.length > 0, findings };
}
