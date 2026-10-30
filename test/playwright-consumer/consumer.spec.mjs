import { match, rejects, strictEqual } from 'node:assert/strict';

import { expect as baseExpect } from '@playwright/test';
import { expect, toMatchUI } from 'slicewright/playwright';

import { delayedTarget, exampleTargets, observed, probe, test } from './fixtures.mjs';
import { runKeyboardScenario } from './focus-consumer.mjs';
import { settleInitialPanel } from './stable-capture.mjs';

// Short runner-semantics deadlines consume a real snapshot captured beforehand.
// Each callback returns independent bytes; every attempted action is an error.
function observedSnapshot(snapshot) {
  const unexpectedAction = async () => { throw new Error('A snapshot probe must only observe.'); };
  return observed({
    measure: async () => structuredClone(snapshot.measurement),
    capture: async () => structuredClone(snapshot),
    hover: unexpectedAction,
    press: unexpectedAction,
    release: unexpectedAction,
    click: unexpectedAction,
  });
}

function snapshotProbe(state) {
  return { ...state, observationSource: 'captured-once', matcherActions: state.actions };
}

for (const renderer of ['dom', 'canvas']) {
  test(`public interaction ${renderer}`, async ({ page, browser, fixtureUrl }, testInfo) => {
    const { panel, action } = await exampleTargets(page, fixtureUrl, renderer);
    const first = await panel.capture();
    const actionBefore = await action.capture();
    const { snapshot: before, attempts } = await settleInitialPanel(
      page, panel, first, testInfo.outputPath('initial-reference'),
    );
    await testInfo.attach('consumer-browser', {
      body: JSON.stringify({
        name: browser.browserType().name(),
        version: browser.version(),
        initialCaptureAttempts: attempts,
      }),
      contentType: 'application/json',
    });
    await expect(panel).toMatchUI({
      reference: before, contentFits: true, text: { status: 'Choose your next adventure.' },
    }, { timeout: 5000 });
    await action.click();
    await expect(panel).toMatchUI({
      changedFrom: before,
      contentFits: true,
      text: { status: 'Quest accepted: 1' },
    }, { timeout: 5000 });
    await expect(action).toMatchUI({
      stableGeometry: { reference: actionBefore.measurement, tolerance: 0 },
    }, { timeout: 5000 });
    const state = await page.evaluate(() => window.browserE2EFixture.getState());
    expect(state.accepted).toBe(1);
    expect(state.paintedAccepted).toBe(1);
  });

  test(`delayed retry ${renderer}`, async ({ page, fixtureUrl }, testInfo) => {
    const { target, state } = observed(await delayedTarget(page, fixtureUrl, renderer));
    const before = await target.capture();
    await target.click();
    await expect(target).toMatchUI({
      changedFrom: before, contentFits: true, text: { label: 'Ready' },
    }, { timeout: 5000, intervals: [800, 1000] });
    expect(state.captures).toBeGreaterThan(2);
    expect(state.actions).toBe(1);
    expect(await page.evaluate(() => window.delayedFixture.state())).toEqual({ clicks: 1, label: 'Ready' });
    await probe(testInfo, state);
  });
}

test('negated retry waits for mismatch', async ({ page, fixtureUrl }) => {
  const { target, state } = observed(await delayedTarget(page, fixtureUrl));
  await target.click();
  await expect(target).not.toMatchUI({ text: { label: 'Waiting' } }, { timeout: 5000, intervals: [800] });
  expect(state.captures).toBeGreaterThan(1);
  expect(state.actions).toBe(1);
});

test('exported matcher extends consumer expect', async ({ page, fixtureUrl }) => {
  const customExpect = baseExpect.extend({ toMatchUI });
  const target = await delayedTarget(page, fixtureUrl);
  await customExpect(target).toMatchUI({ text: { label: 'Waiting' } }, { timeout: 5000 });
});

test('per-call timeout overrides configured timeout', async ({ page, fixtureUrl }) => {
  const target = await delayedTarget(page, fixtureUrl);
  await target.click();
  await expect.configure({ timeout: 20 })(target).toMatchUI(
    { text: { label: 'Ready' } }, { timeout: 5000, intervals: [800] },
  );
});

test('capture exceptions never become assertion success', async ({ page, fixtureUrl }) => {
  const target = await delayedTarget(page, fixtureUrl);
  for (const negated of [false, true]) {
    let captures = 0;
    const broken = { ...target, async capture() { captures++; throw new Error('consumer capture failed'); } };
    const assertion = expect(broken);
    await rejects(() => (negated ? assertion.not : assertion).toMatchUI(
      { text: { label: 'Ready' } }, { timeout: 3000, intervals: [25] },
    ), /consumer capture failed/);
    strictEqual(captures, 1, 'Capture exceptions must not be retried.');
  }
  let captures = 0;
  const laterFailure = {
    ...target,
    async capture() {
      captures++;
      if (captures > 1) { throw new Error('consumer second capture failed'); }
      return target.capture();
    },
  };
  await rejects(() => expect(laterFailure).toMatchUI(
    { text: { label: 'Ready' } }, { timeout: 3000, intervals: [25] },
  ), /consumer second capture failed/);
  strictEqual(captures, 2);
});

test('invalid options fail immediately under both polarities', async ({ page, fixtureUrl }) => {
  const { target, state } = observed(await delayedTarget(page, fixtureUrl));
  const invalid = [
    [{ contentFits: 'yes' }, {}, 1],
    [{ pixels: { mean: 0, p99: 0, max: 0 } }, {}, 1],
    [{ text: { label: 42 } }, {}, 1],
    [{}, { timeout: 0 }, 0],
    [{}, { timeout: -1 }, 0],
    [{}, { timeout: Infinity }, 0],
    [{}, { intervals: [] }, 0],
    [{}, { intervals: [0] }, 0],
    [{}, { intervals: [-1] }, 0],
    [{}, { intervals: [NaN] }, 0],
  ];
  for (const negated of [false, true]) {
    for (const [check, retry, expectedCaptures] of invalid) {
      const before = state.captures;
      const assertion = expect(target);
      await rejects(() => (negated ? assertion.not : assertion).toMatchUI(check, retry));
      strictEqual(state.captures - before, expectedCaptures, 'Invalid configuration must not be retried.');
    }
  }
});

test('artifact failures preserve the original failure', async ({ page, fixtureUrl }, testInfo) => {
  const target = await delayedTarget(page, fixtureUrl);
  const timed = observedSnapshot(await target.capture());
  const originalAttach = testInfo.attach;
  let artifactFailures = 0;
  let captureErrors = 0;
  let timeoutDiagnostic = false;
  testInfo.attach = async () => {
    artifactFailures++;
    throw new Error('consumer attachment failed');
  };
  try {
    for (const kind of ['mutable', 'frozen', 'string']) {
      for (const negated of [false, true]) {
        const message = `${kind} consumer capture failure`;
        const original = kind === 'string' ? message : new Error(message);
        if (kind === 'frozen') { Object.freeze(original); }
        const broken = { ...target, async capture() { throw original; } };
        const assertion = expect(broken);
        await rejects(() => (negated ? assertion.not : assertion).toMatchUI({}), (error) => {
          if (kind === 'mutable') {
            strictEqual(error, original, 'Mutable Error identity must be preserved.');
          } else {
            strictEqual(error instanceof Error, true, 'Playwright must receive a mutable Error.');
            strictEqual(Object.isExtensible(error), true);
            strictEqual(error.cause, original, 'The wrapper must retain the exact thrown cause.');
            strictEqual(error.message.includes(message), true);
          }
          captureErrors++;
          return true;
        });
      }
    }
    const annotations = testInfo.annotations.filter((entry) => entry.type === 'slicewright-artifacts');
    strictEqual(annotations.length, 6);
    for (const annotation of annotations) {
      match(annotation.description ?? '', /consumer attachment failed/);
    }
    await rejects(() => expect(timed.target).toMatchUI(
      { text: { label: 'Missing even when artifacts fail' } }, { timeout: 750, intervals: [25] },
    ), (error) => {
      match(error.message, /Expected browser UI/);
      match(error.message, /browser\.text/);
      match(error.message, /consumer attachment failed/);
      timeoutDiagnostic = true;
      return true;
    });
  } finally {
    testInfo.attach = originalAttach;
  }
  await probe(testInfo, { ...snapshotProbe(timed.state), artifactFailures, captureErrors, timeoutDiagnostic });
});

test('late capture errors cannot replace an expired assertion', async ({}, testInfo) => {
  const originalAttach = testInfo.attach;
  let lateTimeouts = 0;
  let delayedAttachments = 0;
  testInfo.attach = async (name, options) => {
    const diagnostic = JSON.parse(String(options.body));
    match(diagnostic.error, /[Tt]imeout|[Tt]imed out/);
    strictEqual(diagnostic.error.includes('consumer late capture error'), false);
    strictEqual(diagnostic.observation, 'unavailable');
    delayedAttachments++;
    await new Promise((done) => setTimeout(done, 60));
    await originalAttach.call(testInfo, name, options);
  };
  try {
    for (const negated of [false, true]) {
      const target = {
        capture: () => new Promise((resolve, reject) => {
          setTimeout(() => reject(new Error('consumer late capture error')), 40);
        }),
      };
      const assertion = expect(target);
      await rejects(() => (negated ? assertion.not : assertion).toMatchUI(
        {}, { timeout: 20, intervals: [1] },
      ), (error) => {
        match(error.message, /Expected browser UI/);
        match(error.message, /[Tt]imeout|[Tt]imed out/);
        strictEqual(error.message.includes('consumer late capture error'), false);
        lateTimeouts++;
        return true;
      });
    }
  } finally {
    testInfo.attach = originalAttach;
  }
  await probe(testInfo, { lateTimeouts, delayedAttachments });
});

test('fails: project timeout keeps final observation and artifacts', async ({ page, fixtureUrl }, testInfo) => {
  const live = observed(await delayedTarget(page, fixtureUrl, 'dom', 0));
  const reference = await live.target.capture();
  await live.target.click();
  await page.waitForFunction(() => window.delayedFixture.state().label === 'Ready');
  const { target, state } = observedSnapshot(await live.target.capture());
  const started = Date.now();
  try {
    await expect(target).toMatchUI({ reference, text: { label: 'Impossible final label' } }, { intervals: [25] });
  } finally {
    await probe(testInfo, { ...snapshotProbe(state), actions: live.state.actions, elapsed: Date.now() - started, timeout: 1000 });
  }
});

test('fails: configured timeout respects negation', async ({ page, fixtureUrl }, testInfo) => {
  const live = await delayedTarget(page, fixtureUrl);
  const { target, state } = observedSnapshot(await live.capture());
  const started = Date.now();
  try {
    await expect.configure({ timeout: 750 })(target).not.toMatchUI({ text: { label: 'Waiting' } }, { intervals: [25] });
  } finally {
    await probe(testInfo, { ...snapshotProbe(state), elapsed: Date.now() - started, timeout: 750 });
  }
});

test('fails: soft matcher continues after two failures', async ({ page, fixtureUrl }, testInfo) => {
  const live = await delayedTarget(page, fixtureUrl);
  const { target, state } = observedSnapshot(await live.capture());
  await expect.soft(target).toMatchUI({ text: { label: 'First missing label' } }, { timeout: 750, intervals: [25] });
  await expect.soft(target).not.toMatchUI({ text: { label: 'Waiting' } }, { timeout: 750, intervals: [25] });
  await probe(testInfo, { ...snapshotProbe(state), continued: true, errors: testInfo.errors.length });
});

test('fails: concurrent assertions retain distinct artifacts', async ({ page, fixtureUrl }, testInfo) => {
  const first = await delayedTarget(page, fixtureUrl);
  const secondPage = await page.context().newPage();
  try {
    const second = await delayedTarget(secondPage, fixtureUrl, 'canvas');
    const firstObservation = observedSnapshot(await first.capture());
    const secondObservation = observedSnapshot(await second.capture());
    const results = await Promise.allSettled([
      expect(firstObservation.target).toMatchUI({ text: { label: 'Parallel DOM mismatch' } }, { timeout: 1000, intervals: [25] }),
      expect(secondObservation.target).toMatchUI({ text: { label: 'Parallel Canvas mismatch' } }, { timeout: 1000, intervals: [25] }),
    ]);
    await probe(testInfo, {
      ...snapshotProbe({
        captures: firstObservation.state.captures + secondObservation.state.captures,
        actions: firstObservation.state.actions + secondObservation.state.actions,
      }),
      rejected: results.filter((result) => result.status === 'rejected').length,
    });
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) { throw failure.reason; }
  } finally {
    await secondPage.close();
  }
});

function hangingTarget() {
  const unexpectedAction = async () => { throw new Error('A deadline probe must only capture.'); };
  return {
    measure: async () => ({ bounds: { x: 0, y: 0, width: 100, height: 50 } }),
    hover: unexpectedAction,
    press: unexpectedAction,
    release: unexpectedAction,
    click: unexpectedAction,
    capture: () => new Promise(() => {}),
  };
}

test('fails: hanging capture obeys matcher deadline without fake pixels', async ({}, testInfo) => {
  const target = hangingTarget();
  const started = Date.now();
  try {
    await expect(target).not.toMatchUI(
      { text: { label: 'Missing' } }, { timeout: 250, intervals: [25] },
    );
  } finally {
    await probe(testInfo, { elapsed: Date.now() - started, timeout: 250 });
  }
});

test('fails: hanging capture respects remaining test budget', async ({}, testInfo) => {
  test.setTimeout(2000);
  const target = hangingTarget();
  const started = Date.now();
  try {
    await expect(target).toMatchUI(
      { text: { label: 'Missing' } }, { timeout: 5000, intervals: [25] },
    );
  } finally {
    await probe(testInfo, { elapsed: Date.now() - started, timeout: 5000 });
  }
});

for (const renderer of ['dom', 'canvas']) {
  test(`keyboard focus ${renderer}`, async ({ page }, testInfo) => {
    await runKeyboardScenario(page, renderer, 'none', testInfo.outputPath('keyboard'),
      (target, checks) => expect(target).toMatchUI(checks, { timeout: 5000 }));
  });
}
