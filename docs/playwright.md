# Playwright Test integration

`slicewright/playwright` adds `toMatchUI` to Playwright's `expect`. It observes the
same DOM or Canvas target used by `slicewright/browser`, waits for the requested
UI checks to pass, and attaches failure evidence to the test result.

## Install and use

```sh
npm install --save-dev slicewright @playwright/test playwright-core
npx playwright install chromium
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
executes real Playwright Test cases for DOM and Canvas. It checks delayed success,
one-time input, permanent mismatch, negation, soft continuation, configured and
overridden deadlines, invalid inputs, capture errors, and separate attachment
paths for concurrent assertions. Deliberately failing child tests are checked as
negative controls. Their reports are kept under `.slicewright/playwright-e2e/`.
