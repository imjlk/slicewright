# Persistent browser baselines

`saveBrowserBaseline` and `loadBrowserBaseline` preserve a `BrowserSnapshot`
between test runs. They use the same HTML/CSS and Canvas snapshot contract as
the [browser API](browser.md), and loaded snapshots work with the
[Playwright Test matcher](playwright.md).

## Compare an existing baseline

Inside Playwright Test, use the named baseline matcher:

```ts
await expect(panel).toMatchUIBaseline('quest-panel.slicewright.json', {
  environment: 'linux-chromium-wide-dpr1-fonts-v1',
  checks: { contentFits: true },
  timeout: 3000,
});
```

Import `expect` from `slicewright/playwright`. The matcher resolves the exact
name through `testInfo.snapshotPath(name)`, including your project's
`snapshotPathTemplate`. Use distinct names within a test file and separate
paths for different projects/platforms. The explicit environment key is still
required; a path is not proof of compatible rendering.

Loading and fresh captures share the assertion deadline. The baseline is loaded
once and remains fixed throughout polling. Optional `checks` accepts the usual
browser checks and regional tolerances, except `reference`, which is always the
approved snapshot. `.not` succeeds on a valid visual mismatch; a missing,
corrupt or incompatible baseline fails in both polarities. `expect.soft` and
configured timeouts work as with `toMatchUI`. Failure JSON records the resolved
path and environment; valid observations attach the reference and HTML report.

This matcher is read-only even with `--update-snapshots`. Create or replace a
baseline only through the separate approval operation below. For your own
expect instance, use `baseExpect.extend({ toMatchUIBaseline })` with the exported
matcher from `slicewright/playwright`.

To load references explicitly, or use a different runner, keep using the
baseline APIs directly:

Choose the baseline path and a rendering-environment key in your project:

```ts
import { test } from '@playwright/test';
import { domTarget, loadBrowserBaseline } from 'slicewright/browser';
import { expect } from 'slicewright/playwright';

test('quest panel matches its approved design', async ({ page }, testInfo) => {
  await page.goto('/quests');
  const panel = domTarget(page, {
    root: page.locator('#panel'),
    contentBox: page.locator('#content'),
    content: { title: page.locator('#title'), status: page.locator('#status') },
  });
  const baseline = await loadBrowserBaseline(
    testInfo.snapshotPath('quest-panel.slicewright.json'),
    { environment: 'linux-chromium-wide-dpr1-fonts-v1' },
  );
  await expect(panel).toMatchUI({
    reference: baseline,
    contentFits: true,
    stableGeometry: { reference: baseline.measurement, tolerance: 0.1 },
  });
});
```

For Canvas, use a `regionTarget` with your renderer's measured bounds and text
metrics. No engine-specific baseline format is needed. Plain Node scripts and
other test runners can pass the loaded snapshot to `checkSnapshot` directly.

The environment key is an explicit, nonempty string. Use it to distinguish the
browser/build, platform, viewport, device scale, fonts, and other assumptions
that affect pixels. The value must match exactly on load. Slicewright does not
read the browser environment or infer that two keys are compatible; generate
the key and select paths from your own runner configuration. Keep baseline
generation and comparisons in equivalent rendering environments.

## Approve creation or replacement

After reviewing the candidate image, call save from a separate approval command:

```ts
import { saveBrowserBaseline } from 'slicewright/browser';

const reviewed = await panel.capture();
await saveBrowserBaseline('baselines/quest-panel.slicewright.json', reviewed, {
  approved: true,
  environment: 'linux-chromium-wide-dpr1-fonts-v1',
});
```

`approved: true` is required at runtime for both creation and replacement. Keep
this call out of ordinary regression tests: saving before comparing would turn
the current render into its own reference. Missing baselines fail to load;
failed assertions do not save them. Playwright's `--update-snapshots` flag and
environment variables do not automatically approve these baselines. Your
approval command explicitly decides when to call the save API.

## Files and validation

The path names a version-one JSON manifest containing the format identifier,
environment key, target/content/text measurements, clip, raster dimensions, and
PNG SHA-256 digest. Its image is a sibling named from the manifest filename and
digest. Commit the manifest and the corresponding PNG together. The manifest
does not accept arbitrary image paths or URLs.

Loading validates the JSON, supported format/version, environment, PNG digest,
decoded pixels, measurements, and consistent dimensions. Missing files,
corruption, and incompatible metadata are errors. Loading never modifies files.
The loaded measurement and pixel data can be compared without rebuilding them
from an artifact report.

Save validates and serializes before writing. It stages a complete image before
exposing its content-addressed filename, then replaces the manifest with a
same-directory rename. Readers can continue using an earlier complete baseline
while an approval is being written. Old image files are retained because another
reader may still have the previous manifest; remove unused images only when no
readers need them. Temporary files are cleaned up, and an image-install failure
does not replace a previously valid manifest. This does not guarantee survival
of storage failure or serialize competing approvals.

## Verification

Unit tests cover round trips, explicit replacement, input rejection without
writes, environment/version/digest/dimension errors, concurrent readers and
writers, and preservation after an image-install failure. The packed browser
consumer saves real DOM and Canvas captures, loads them in a separate Node
process, and checks both an unchanged render and a real input-driven change
against the stored reference.
