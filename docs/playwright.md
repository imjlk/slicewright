# Playwright Test integration

`slicewright/playwright` adds `toMatchUI` to Playwright's `expect`. It observes the
same DOM or Canvas target used by `slicewright/browser`, waits for the requested
UI checks to pass, and attaches failure evidence to the test result.

## Install and use

```sh
npm install --save-dev slicewright @playwright/test playwright-core
npx playwright install chromium firefox webkit
```

Use Node 24 or newer. `@playwright/test` is optional: the core CLI/library and
`slicewright/browser` do not import the test runner. Assertions from this entry
point require an active Playwright Test.

```ts
import { test } from '@playwright/test';
import { domTarget } from 'slicewright/browser';
import { expect } from 'slicewright/playwright';

test('accepting a quest updates its panel', async ({ page }) => {
  await page.goto('/quests');
  const panel = domTarget(page, {
    root: page.locator('#panel'),
    contentBox: page.locator('#content'),
    content: {
      title: page.locator('#title'),
      action: page.locator('#action'),
      status: page.locator('#status'),
    },
  });
  const action = domTarget(page, { root: page.locator('#action') });
  const before = await panel.capture();

  await action.click();
  await expect(panel).toMatchUI({
    text: { status: 'Quest accepted: 1' },
    contentFits: true,
    changedFrom: before,
  }, { timeout: 2000 });
});
```

For Canvas, replace the bindings with `regionTarget(page, { measure, prepare })`;
the assertion is identical. See the [browser guide](browser.md) for explicit
CSS-coordinate content boxes and text metrics. The matcher does not infer text
areas or set application state.

## Waiting and assertion semantics

Each attempt captures a new snapshot and calls `checkSnapshot` with the supplied
checks. Valid observations that do not satisfy the expectation are retried.
Input remains outside the matcher: the example clicks once, even when rendering
needs several attempts. Never place the click in a polling callback.

The timeout defaults to the active expect configuration, or 5000 ms when none is
provided. A per-call timeout overrides it. Playwright's remaining test budget
still applies. Timeouts and polling intervals must be finite and positive; zero
does not disable the deadline for this matcher.

Polling follows Playwright's scheduling: if the next interval cannot fit before
the deadline, the assertion can fail before the full timeout has elapsed. Use
intervals smaller than the timeout when you want repeated observations.

```ts
const expectUI = expect.configure({ timeout: 3000 });
await expectUI(panel).toMatchUI({ text: { status: 'Ready' } });

await expect(panel).toMatchUI({ text: { status: 'Ready' } }, {
  timeout: 1500,
  intervals: [50, 100, 250],
});
```

Playwright's normal `expect.soft` and `.not` syntax works:

```ts
await expect.soft(panel).toMatchUI({ contentFits: true });
await expect(panel).not.toMatchUI({ text: { status: 'Loading' } });
```

Negation succeeds when a valid observation fails at least one supplied check.
To test that a particular state is absent, supply that state's expectation
alone. Capture errors and invalid configurations fail immediately in either
polarity. They are not treated as an ordinary UI mismatch. Prepare fonts, images,
and layout as needed before observing; movement during a capture remains a
capture error.

You can combine the exported matcher with your own matcher collection:

```ts
import { expect as baseExpect } from '@playwright/test';
import { toMatchUI } from 'slicewright/playwright';

const expect = baseExpect.extend({ toMatchUI });
```

## Failure evidence

On failure, each assertion uses a unique output location and attachment prefix.
A valid final observation produces `actual.png`, the available expected/previous
images and differences, and the browser report with measurements and findings.
An assertion diagnostic records its polarity, timeout, attempt count, and error;
this also explains negated failures whose underlying UI checks passed.

If capture fails, there is no invented screenshot. Any earlier valid observation
is identified as such alongside the failure diagnostic. Artifact errors are
reported without replacing the assertion or capture error. Successful assertions
do not write failure attachments. Your existing Playwright reporter and trace
configuration continue to manage the overall test run.

Playwright annotates thrown errors with test-step information. Immutable errors
and non-Error thrown values are wrapped in an extensible `Error` whose `cause`
retains the original value; ordinary extensible errors keep their identity.

## Consumer verification

After `pnpm build`, run `pnpm playwright:check`. It installs the tarball outside
the repository, validates public declarations and optional-peer isolation, and
executes the same real Playwright Test cases for DOM and Canvas in Chromium,
Firefox, and WebKit projects. It checks delayed success,
one-time input, permanent mismatch, negation, soft continuation, configured and
overridden deadlines, invalid inputs, capture errors, and separate attachment
paths for concurrent assertions. Deliberately failing child tests are checked as
negative controls. Their reports are kept under `.slicewright/playwright-e2e/`.

Interaction and delayed-render checks capture the live UI on every attempt.
Short deadline, soft-assertion, concurrent-attachment, and attachment-error
probes first capture real DOM or Canvas snapshots outside the timed assertion.
Their observation callbacks return fresh copies of those snapshots and reject
actions, so these probes measure runner behavior independently of native
screenshot latency. Callback counts, exact findings, images, reports, and
deadline diagnostics remain required.

Use named projects in your application's Playwright config to run the same test
against each browser:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
```

Use separate [persistent baselines](baselines.md) and rendering-environment keys
per project/platform. The matcher API stays the same; cross-browser pixel
identity is not assumed. See [browser engine verification](browser.md#browser-engines)
for repository setup and report locations.

For a previously approved baseline, the same target can use:

```ts
await expect(panel).toMatchUIBaseline('quest-panel.slicewright.json', {
  environment: 'linux-chromium-wide-dpr1-fonts-v1',
  checks: { contentFits: true },
  timeout: 3000,
});
```

The runner's snapshot path resolves the manifest name. The matcher validates and
loads it once within the deadline, then polls fresh captures. Missing or invalid
baselines fail even under `.not`; `--update-snapshots` never approves or changes
these files. See the [baseline guide](baselines.md) for explicit approval.

### Offline failure reports

A failed UI assertion with a valid snapshot now attaches one self-contained HTML
report alongside JSON and PNG diagnostics. Open the HTML attachment directly to
compare images and inspect measured regions, regional policies, and rendering
context. The report identifies assertion failure separately from positive
snapshot checks, so failed `.not` assertions never appear as successful tests.

If capture never produced a valid snapshot, only assertion JSON is attached.
Passing assertions create no failure artifacts. If HTML creation/attachment
fails, existing diagnostics and the original assertion error remain available.

### Wait for sampled visual stability

```ts
await expect(panel).toBeStableUI({ duration: 300, timeout: 5000, intervals: [50] });
// Wait for an actual change between observations:
await expect(panel).not.toBeStableUI({ timeout: 2000 });
```

The same API works with DOM, Canvas, and custom targets. At least two captures
must span `duration` (200 ms by default). Each sample must match the window's
first image and absolute geometry, text, focus, and viewport/DPR; a change starts
a new window. This checks sampled observations, not every animation frame.
Use application readiness signals before asserting when an animation starts late.

Pixels default to exact equality. Explicit `pixels: { mean, p99, max }` tolerances
apply against the fixed window anchor, preventing small cumulative changes from
being hidden by adjacent-frame comparisons. Labels and browser identity do not
change the verdict. Negation waits for an observed change; an incomplete window
alone cannot pass it. Native assertion/test deadlines, soft assertions, capture
errors, and offline failure reports behave as in `toMatchUI`. Failures include the
last compared anchor image and distinguish a pending duration from observed drift.

For a custom consumer expect instance, import `toBeStableUI` and pass it to
`baseExpect.extend({ toBeStableUI })` alongside `toMatchUI` as needed.
