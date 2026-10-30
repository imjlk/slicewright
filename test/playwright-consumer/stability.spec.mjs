import { rejects, strictEqual } from 'node:assert/strict';
import { expect as baseExpect } from '@playwright/test';
import { domTarget, regionTarget } from 'slicewright/browser';
import { expect, toBeStableUI } from 'slicewright/playwright';
import { observed, probe, test } from './fixtures.mjs';

async function panel(page, renderer = 'dom') {
  await page.setContent('<style>body{margin:0}#panel{display:block;width:80px;height:40px;background:rgb(0,70,90)}</style>' +
    (renderer === 'dom' ? '<div id="panel"></div>' : '<canvas id="panel" width="80" height="40"></canvas>'));
  await page.evaluate(() => {
    window.paint = red => {
      const element = document.querySelector('#panel');
      const color = `rgb(${red},70,90)`;
      if (element instanceof HTMLCanvasElement) {
        const context = element.getContext('2d');
        context.fillStyle = color;
        context.fillRect(0,0,80,40);
      } else element.style.background = color;
    };
    window.paint(0);
  });
  return renderer === 'dom' ? domTarget(page, { root: page.locator('#panel') }) :
    regionTarget(page, { measure: async () => ({ bounds: { x: 0, y: 0, width: 80, height: 40 } }) });
}

function snapshots(snapshot, change = false) {
  let captures = 0;
  const unexpected = async () => { throw new Error('Stability must not issue input actions.'); };
  return observed({
    measure: unexpected, hover: unexpected, press: unexpected, release: unexpected, click: unexpected,
    capture: async () => {
      captures++;
      const actual = structuredClone(snapshot);
      if (change) actual.raster.data.fill(captures % 2 ? 0 : 255);
      return actual;
    },
  });
}

for (const renderer of ['dom', 'canvas']) {
  test(`stability settles ${renderer}`, async ({ page }) => {
    const { target, state } = observed(await panel(page, renderer));
    await page.evaluate(() => {
      window.steps = 0;
      const timer = setInterval(() => {
        window.paint(++window.steps * 10);
        if (window.steps === 15) clearInterval(timer);
      }, 40);
    });
    const customExpect = baseExpect.extend({ toBeStableUI });
    await customExpect(target).toBeStableUI({ duration: 300, timeout: 8000, intervals: [50] });
    strictEqual(await page.evaluate(() => window.steps), 15);
    expect(state.captures).toBeGreaterThan(1);
    strictEqual(state.actions, 0);
  });
}

test('stability negation waits for observed change', async ({ page }) => {
  const snapshot = await (await panel(page)).capture();
  const { target, state } = snapshots(snapshot, true);
  await expect(target).not.toBeStableUI({ duration: 5000, timeout: 1000, intervals: [20] });
  strictEqual(state.captures, 2);
  strictEqual(state.actions, 0);
});

test('stability invalid input and capture errors', async ({ page }) => {
  const snapshot = await (await panel(page)).capture();
  const { target, state } = snapshots(snapshot);
  for (const negative of [false, true]) {
    const assertion = negative ? expect(target).not : expect(target);
    await rejects(() => assertion.toBeStableUI({ duration: 0 }), /duration/);
    await rejects(() => assertion.toBeStableUI({ pixels: { mean: 0, p99: 0, max: -1 } }), /tolerances/);
    const broken = { ...target, capture: async () => { throw new Error('stability capture failed'); } };
    await rejects(() => (negative ? expect(broken).not : expect(broken)).toBeStableUI(), /stability capture failed/);
  }
  strictEqual(state.captures, 0);
});

for (const mode of ['pending negation', 'persistent drift', 'stable negation']) {
  test(`fails: stability ${mode}`, async ({ page }, testInfo) => {
    const snapshot = await (await panel(page)).capture();
    const { target, state } = snapshots(snapshot, mode === 'persistent drift');
    const started = performance.now();
    try {
      await (mode === 'persistent drift' ? expect(target) : expect(target).not).toBeStableUI({
        duration: mode === 'pending negation' ? 5000 : 50,
        timeout: 250,
        intervals: [20],
      });
    } finally {
      await probe(testInfo, { ...state, elapsed: performance.now() - started, timeout: 250 });
    }
  });
}
