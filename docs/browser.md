# Browser UI verification

`slicewright/browser` adds UI-specific checks to your existing Playwright tests.
HTML/CSS and Canvas use the same target interface. The binding supplies geometry;
the scenario drives actual mouse input and checks the resulting pixels and text.
No engine or application state setters are involved.

When using Playwright Test, the optional [matcher integration](playwright.md)
handles repeated observations and failure attachments for you. The lower-level
API below remains available to other runners and scripts.

## Install

Use Node 24 or newer. In a project using Playwright Test:

```sh
npm install --save-dev slicewright @playwright/test playwright-core
npx playwright install chromium
```

Browser tooling is an optional peer dependency. Importing `slicewright` or using
the CLI does not import it or install a browser. This entry point runs in the
Node test process, not in the application's browser bundle. You can also use a
plain Playwright script; browser lifecycle, application readiness, retries,
baseline approval, and traces belong to your test runner.

## Bind either renderer

```ts
import { domTarget, regionTarget } from 'slicewright/browser';

// HTML/CSS: locators must belong to this page's main frame.
const panel = domTarget(page, {
  root: page.locator('#panel'),
  contentBox: page.locator('#content'),
  content: {
    title: page.locator('#title'),
    action: page.locator('#action'),
    status: page.locator('#status'),
  },
});
const action = domTarget(page, {
  root: page.locator('#action'),
  contentBox: page.locator('#action-content'),
  content: { label: page.locator('#action-label') },
});

// Canvas: expose a read-only bridge using the geometry and text metrics
// actually used by your renderer. These callbacks execute in the test process.
const canvasPanel = regionTarget(page, {
  prepare: () => page.evaluate(() => window.ui.ready),
  measure: () => page.evaluate(() => window.ui.measure('panel')),
});
const canvasAction = regionTarget(page, {
  prepare: () => page.evaluate(() => window.ui.ready),
  measure: () => page.evaluate(() => window.ui.measure('action')),
});
```

`window.ui` above is an application-defined bridge; declare its type in your own
tests. The [working example](../examples/browser-e2e) supplies one as
`window.browserE2EFixture`. It has no dependency on Phaser or a scene graph.

A measurement has this shape:

```ts
{
  bounds: { x: 20, y: 40, width: 300, height: 240 },
  contentBox: { x: 48, y: 70, width: 244, height: 180 },
  content: {
    title: {
      bounds: { x: 48, y: 70, width: 244, height: 30 },
      text: 'Quest board',
      textBounds: [{ x: 80, y: 75, width: 180, height: 22 }],
    },
  },
}
```

All rectangles use **main-page viewport CSS pixels**, including Canvas. Convert
Canvas backing-store coordinates, transforms, camera offsets, and frame offsets
in your bridge. Do not multiply CSS bounds by device pixel ratio. DOM bindings
read text-node Range rectangles; Canvas bindings can return the actual painted
line rectangles from `TextMetrics`. Content areas are explicitly authored;
ornamentation is never used to guess where text belongs.

## Run one scenario for both

```ts
import { expect } from '@playwright/test';
import {
  checkSnapshot,
  writeBrowserArtifacts,
  type BrowserTarget,
} from 'slicewright/browser';

async function verifyAccept(panel: BrowserTarget, action: BrowserTarget, output: string) {
  const normal = await action.capture();
  await action.hover();
  const hovered = await action.capture();
  expect(checkSnapshot(hovered, {
    changedFrom: normal,
    stableGeometry: { reference: normal.measurement },
    contentFits: true,
    text: { label: 'Accept quest' },
  }).findings).toEqual([]);

  await action.press();
  const pressed = await action.capture();
  expect(checkSnapshot(pressed, {
    changedFrom: hovered,
    stableGeometry: { reference: normal.measurement },
    contentFits: true,
    text: { label: 'Accept quest' },
  }).findings).toEqual([]);
  await action.release();

  await expect.poll(async () => (await panel.measure()).content?.status?.text)
    .toBe('Quest accepted: 1');
  const actual = await panel.capture();
  const report = checkSnapshot(actual, {
    text: { status: 'Quest accepted: 1' },
    contentFits: true,
  });
  await writeBrowserArtifacts(output, { actual, report });
  expect(report.findings).toEqual([]);
}

// Use the same function with either pair of bindings.
await verifyAccept(panel, action, testInfo.outputPath('dom-accept'));
// In a Canvas test: await verifyAccept(canvasPanel, canvasAction, ...);
```

Wait for application-specific fonts, images, and state updates before capturing.
`hover`, `press`, and `click` remeasure and send mouse input to the target center.
`press` moves then presses; `release` releases at the current pointer, preserving
the real behavior if a button moved during a press. An intercepted or disabled
click can return normally: assert the application outcome to detect it. Use
`page.keyboard`, your runner's assertions, and traces for other interactions.

Capture rounds outwards to integer CSS pixels, accounts for scrolling, and uses
one output pixel per CSS pixel at any DPR. Movement during capture and truncated
captures are errors. Keep animations stable when comparing references. Targets
whose centers are outside the viewport must be scrolled into view first, either
by your test or a region binding's `prepare` callback.

## Checks and artifacts

`checkSnapshot` is a pure checker. It returns `ok`, `findings`, and pixel
difference statistics when a comparison is requested. Bad inputs throw; valid
measurements that violate an expectation produce findings.

| Expectation | What it checks |
| --- | --- |
| `reference: expected` | Exact premultiplied RGBA equality by default. |
| `pixels: { mean, p99, max }` | Complete nonnegative tolerances for a supplied reference. |
| `changedFrom: previous` | At least one visible pixel changed; not proof of a particular expected design. |
| `stableGeometry: { reference: earlier.measurement, tolerance: 0 }` | Target size and target-relative content geometry; scrolling alone is allowed. |
| `text: { name: 'Expected text' }` | Exact text in each named content item. |
| `contentFits: true` | Explicit content box, item boxes, and supplied text bounds fit their containers. |

Missing fit instrumentation fails. Without `textBounds`, only declared boxes are
checked. Geometry checks cannot establish paint visibility, ancestor clipping,
occlusion, or whether a string was truly drawn. Compare rendered references for
those claims. A visible-change check must be paired with the expected application
result; a blinking caret alone can change pixels. Pixel references should use the
same browser, fonts, viewport, and rendering environment.

A reference is a `BrowserSnapshot` from `capture()`, or a saved snapshot loaded
by your test. When persisting a baseline, keep its measurement and clip metadata
along with the PNG; the artifact report includes that metadata. Pixel comparison
does not require equal text or geometry unless you request those checks too.

```ts
const report = checkSnapshot(actual, {
  reference: expected,
  pixels: { mean: 0.5, p99: 2, max: 10 },
});
await writeBrowserArtifacts(testInfo.outputPath('panel'), {
  actual, reference: expected, changedFrom: previous, report,
});
```

The writer saves `actual.png`, `expected.png` and `diff.png` when a reference is
available, `previous.png` and `change.png` for a transition, and `report.json`
with measurements. Size mismatches produce findings instead of invalid pixel
comparisons. Baseline approval remains explicit in your project. The writer
does not automatically update a baseline.

## Repository proof

After `pnpm build`, run `pnpm browser:check`. It packs the package, installs it in
a fresh consumer project, and runs the same scenario for HTML/CSS and Canvas at
narrow and wide widths, DPR 1 and 2, and a scrolled position. Deliberate missing
handlers, stale painting, shifted content, clipped text, and an input-blocking
overlay must be caught. Artifacts are saved under `.slicewright/browser-e2e/` and
uploaded by CI on Linux and Windows. No repository source import or private tool
copy is required by the consumer.
