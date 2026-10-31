# Browser UI verification

`slicewright/browser` adds UI-specific checks to your existing Playwright tests.
HTML/CSS and Canvas use the same target interface. The binding supplies geometry;
the scenario drives actual mouse input and checks the resulting pixels and text.
No engine or application state setters are involved.

When using Playwright Test, the optional [matcher integration](playwright.md)
handles repeated observations and failure attachments for you. The lower-level
API below remains available to other runners and scripts.

## Install

Use Node 22 or newer. In a project using Playwright Test:

```sh
npm install --save-dev slicewright @playwright/test playwright-core
npx playwright install chromium firefox webkit
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
with `loadBrowserBaseline`. The [baseline guide](baselines.md) covers explicit
approval, versioned metadata, and environment matching. Pixel comparison
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

## Browser engines

The same `domTarget`, `regionTarget`, snapshot checks, and baseline APIs are
verified with Playwright's Chromium, Firefox, and WebKit. Keep references local
to a browser and rendering environment; font rasterization and pixels can differ
between engines and operating systems. WebKit verification is not a claim about
a specific released Safari version or mobile device.

For repository verification, install the locked browsers and run both consumers:

```sh
pnpm exec playwright install chromium firefox webkit
pnpm build
pnpm browser:check
pnpm playwright:check
```

On Linux, use `pnpm exec playwright install --with-deps chromium firefox webkit`
to install system dependencies too. Missing engines fail the command with
installation guidance. `SLICEWRIGHT_CHROME_CHANNEL` selects an installed Chrome
channel for Chromium only; Firefox and WebKit always use the locked engines.

The browser consumer runs identical DOM/Canvas scenarios in all three engines,
including scroll and DPR changes, fixed/sticky captures, persisted baselines,
and deliberate failures. Its report records each browser's name and version;
artifacts are separated by engine under `.slicewright/browser-e2e/`. Before
choosing a static initial reference, both consumers require two
consecutive identical captures within five observations. This is read-only
render preparation: later mismatches do not update that reference, and inputs
still run once. The
Playwright consumer also runs every assertion scenario in three named projects
and keeps their results under `.slicewright/playwright-e2e/`.

Baseline save/load remains byte-exact. For the consumer's fresh capture after
loading, the fixture explicitly allows RGB error inside measured text bounds
of mean `0.01`, p99 `0`, and maximum `32` on the 0–255 scale. Windows Firefox
produced 14 differing glyph-edge pixels despite two identical setup captures;
the saved pixels, metadata, and alpha were unchanged. The consumer still
requires exact metadata, alpha, and pixels outside text bounds. Negative boundary
probes and the real activation must fail under this same policy. This allowance can
hide tiny text changes within its budget; it does not change the library's
zero-tolerance default or the other interaction checks.


## Keyboard focus

Send keys through Playwright; the browser targets and matcher only observe.
DOM targets report the root element's `:focus` and `:focus-visible` states.
Canvas bindings supply the same `focus: { focused, visible }` measurement from
explicit application instrumentation. A focused descendant does not make a DOM
container focused. Missing instrumentation fails even when expecting false.

```ts
import { expect } from 'slicewright/playwright';

const before = await action.capture();
await page.keyboard.press('Tab');
await expect(action).toMatchUI({
  focus: { focused: true, visible: true },
  changedFrom: before,
});
await page.keyboard.press('Enter');
await expect(panel).toMatchUI({ text: { status: 'Quest accepted: 1' } });
```

`visible` describes focus-visible state, not whether an indicator was painted.
Use a focused reference or an isolated `changedFrom` comparison to verify pixels;
unrelated animations can also change pixels. Disabled-control skipping and
activation behavior belong to the application and must be tested with real keys.
Saved baselines preserve focus metadata; old baselines without it still load but
cannot satisfy a focus assertion.

The repository keyboard fixture explicitly declares `tabindex="0"` on its
controls so its expected tab order is independent of macOS WebKit's default
button-navigation preference. Targets do not modify focusability or system
preferences. Test your application's intended tab order in its own environment.

## Offline failure report

After `writeBrowserArtifacts` (or downloading a Playwright failure artifact directory):

```sh
slicewright browser-report ./artifacts/panel --out ./panel-report.html
```

Open the new HTML file directly in a browser. It embeds all available PNGs, so
it can be moved or shared as one file without a server. Switch between actual,
expected, previous, and difference images; blend actual over a reference; toggle
measured target, content, and text rectangles. Findings, details, clip, dimensions,
and supplied focus state are retained. Captured snapshots include observed browser/version, viewport, DPR, and runner
platform. Old/custom snapshots without this context remain unrecorded. Font-set
and application identity can be supplied as explicit labels.

The command returns JSON and exits 0 for a passing report, 1 for a report with
findings, or 2 for invalid input/output. It refuses existing output files and
never approves or edits baselines. The same operation is available as
`await writeBrowserReportHtml(directory, output)` from `slicewright/browser`.
Keep `report.json` and its fixed PNG filenames together. JSON artifact paths
are ignored; corrupt JSON, invalid measurements, mismatched PNG dimensions,
and symlinked artifact files are refused.

## Explicit regional pixel policies

Give dynamic pixels their own budget without relaxing the surrounding border,
icon, or layout. The same `pixelRegions` option works with `checkSnapshot` and
`toMatchUI` for DOM and Canvas targets:

```ts
const reference = await target.capture();
// An application-declared area, measured in image-local CSS pixels.
const policy = [{
  name: 'status-fill',
  bounds: [{ x: 24, y: 24, width: 60, height: 24 }],
  pixels: { mean: 2, p99: 2, max: 2 },
}];
await page.getByRole('button', { name: 'Refresh' }).click();
await expect(target).toMatchUI({ reference, pixelRegions: policy });
```

For a measured viewport rectangle, subtract the snapshot's `clip.x` and
`clip.y` to obtain image-local coordinates. Do not multiply by device pixel
ratio: browser captures already use CSS pixels. Fractional rectangles include
all touched pixels. Bounds must lie fully inside the image and must not overlap
after rounding, even within a region. Multiple disjoint rectangles share one
region's sample count and budget.

Each region computes its own mean, p99, and maximum on the 0–255 premultiplied
error scale. Everything outside stays exact, and alpha must be identical
everywhere. A region budget can admit a small real visual regression: name and
bound it deliberately. This API never infers text or ignores an area for you.
It cannot be combined with the whole-image `pixels` option. Geometry and text
assertions are still separate, while `changedFrom` always checks the full image.

Reports retain the full-image statistics for diagnosis and expose `pixelPolicy`
with each name, declared/rounded bounds, tolerance, sample count, statistics,
and alpha-change count, plus the strict outside result. A passing regional
policy may therefore have nonzero whole-image differences. The HTML report
includes a dedicated policy section. References of a different size still fail.

### Rendering context

`domTarget(page, { root, environmentLabels: { fontSet: 'game-fonts-v2' } })`
and `regionTarget(page, { measure, environmentLabels: { fontSet: 'game-fonts-v2' } })`
record the same optional labels alongside observed browser/version, viewport,
DPR and runner platform in `snapshot.rendering`. Labels are caller assertions;
they do not inspect fonts or approve a baseline. Runner platform describes the
Node host, not necessarily the operating system of a remote browser.

Baseline save/load preserves this context, but its explicit `environment` key
still controls approval compatibility. Rendering metadata alone does not reject
an otherwise matching pixel or geometry assertion. Existing custom snapshots
without metadata remain supported.
