# Browser regression checks

Use Slicewright's optional browser APIs for rendered HTML/CSS, Canvas or a custom
browser target. Node 22+ and the project's installed Playwright browser engines
are required. `toMatchUIBaseline` requires Slicewright 0.5+; older installations
can explicitly load a baseline and pass it to `toMatchUI`.

Bind DOM roots and real content regions with `domTarget`. For Canvas, use
`regionTarget` with application-supplied layout and actual drawing text metrics.
Keep ornament placement separate from content regions; an image does not imply
a safe text area. Canvas metadata alone cannot prove that text was painted.

Perform each pointer or keyboard action once, outside assertions. Wait for the
application's readiness signal before `toBeStableUI`; its duration covers sampled
observations and cannot predict an animation that starts later. Compare both the
painted result and the relevant content/text/state expectations.

```ts
import { test } from '@playwright/test';
import { domTarget } from 'slicewright/browser';
import { expect } from 'slicewright/playwright';

// The approved rendering assumptions this project controls.
const approvedEnvironment = 'chromium-1280x720-dpr1-noto-sans';

test('collecting the letter updates the quest panel', async ({ page }) => {
  await page.goto('/quest');
  const panel = domTarget(page, {
    root: page.getByTestId('quest-panel'),
    contentBox: page.getByTestId('quest-panel-content'),
    content: { status: page.getByTestId('quest-status') },
  });

  await page.getByRole('button', { name: 'Collect letter' }).click();
  await expect(panel).toBeStableUI({ duration: 300 });
  await expect(panel).toMatchUIBaseline('quest-collected.slicewright.json', {
    environment: approvedEnvironment,
    checks: { contentFits: true, text: { status: 'Letter collected!' } },
  });
});
```

Choose names and runner snapshot paths that separate renderer, state, browser,
viewport, platform and any other visual variants. The explicit environment key
must describe the assumptions the project controls, including browser builds and
fonts. Do not compare unrelated rendering environments by raising tolerances.
Use regional tolerances only for a reviewed source of intended variation.

A regression run reads existing approved baselines. Missing, corrupt or
environment-mismatched references are errors, including under `.not`.
`--update-snapshots` does not approve Slicewright references. When the task calls
for accepting a reviewed design or updating baselines, explicitly save with
`saveBrowserBaseline(path, snapshot, { approved: true, environment })` and retain
the manifest and its PNG together. A failed comparison alone is not a reason to
replace its reference.

Exercise the smallest intended viewport, longer translated copy, enlarged text
and real input through the same tests. On failure, inspect the attached HTML and
actual/reference/diff images together with measured regions. State whether the
problem is the rendered UI, missing instrumentation, or an incompatible baseline.

The [runnable approval workflow](https://github.com/imjlk/slicewright/tree/main/examples/baseline-workflow)
demonstrates English/Korean, narrow/wide viewports and 200% text in both DOM and
Canvas, separate approval/comparison commands, and an injected painted regression.
Use its matrix as an example, adapting coverage to the user's application.
See the [baseline guide](https://github.com/imjlk/slicewright/blob/main/docs/baselines.md)
for storage rules and the [Playwright guide](https://github.com/imjlk/slicewright/blob/main/docs/playwright.md)
for timeout, negation, soft assertion and diagnostic behavior.
