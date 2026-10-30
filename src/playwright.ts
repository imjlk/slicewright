import { randomUUID } from 'node:crypto';

import {
  expect as baseExpect,
  test,
  type ExpectMatcherState,
  type MatcherReturnType,
  type TestInfo,
} from '@playwright/test';
import typia from 'typia';

import { loadBrowserBaseline } from './browser-baseline.js';
import { createStabilityObserver, type StabilityOptions } from './browser-stability.js';

import {
  checkSnapshot,
  writeBrowserArtifacts,
  writeBrowserReportHtml,
  type BrowserCheckOptions,
  type BrowserReport,
  type BrowserSnapshot,
  type BrowserTarget,
} from './browser.js';

export interface PlaywrightMatchOptions {
  /** A finite positive assertion timeout; defaults to the active expect configuration. */
  readonly timeout?: number;
  /** A nonempty list of finite positive delays; the final delay repeats. */
  readonly intervals?: readonly number[];
}

/**
 * Observes a browser target with Playwright Test's assertion and test deadlines.
 * Only valid mismatches retry; actions remain the caller's responsibility.
 *
 * @evidence docs/spec.md#browser-failure-context Attaches HTML after JSON and PNG diagnostics with explicit assertion failure context while preserving missing-capture and error paths.
 * @evidenceReview docs/spec.md#browser-failure-context #0d2038e Read failure attachment ordering, unique paths, negation context and artifact-error propagation.
 * @evidence docs/spec.md#playwright-test-integration Integrates observation-only retry, native negation and soft assertions, positive deadlines, immediate observation errors, and unique failure attachments with Playwright Test.
 * @evidenceReview docs/spec.md#playwright-test-integration #4274194 Read the polling-budget contract and ran the packed Playwright consumer: 11 passing cases and 6 intended failures verified polarity, soft continuation, deadlines, capture-only retries, immutable error causes, late rejection and 49 failure attachments.
 */
export async function toMatchUI(
  this: ExpectMatcherState,
  target: BrowserTarget,
  checks: BrowserCheckOptions,
  options: PlaywrightMatchOptions = {},
): Promise<MatcherReturnType> {
  return runUIAssertion.call(this, target, checks, options, 'toMatchUI');
}

export interface PlaywrightStabilityOptions extends PlaywrightMatchOptions, StabilityOptions {}

export interface PlaywrightBaselineOptions extends PlaywrightMatchOptions {
  /** Must exactly match the approved baseline's caller-owned environment key. */
  readonly environment: string;
  /** Additional checks; the reference is always the loaded baseline. */
  readonly checks?: Omit<BrowserCheckOptions, 'reference'> & { readonly reference?: never };
}

/**
 * Compares an existing approved baseline using the active runner's snapshot path.
 * @evidence docs/spec.md#playwright-baseline-assertions Loads a fixed validated reference under the native assertion deadline and shares read-only observation, error and artifact handling.
 * @evidenceReview docs/spec.md#playwright-baseline-assertions #528d222 Read the baseline contract, bounded one-time load, post-timeout guard, shared polarity/error paths and diagnostic context; baseline saving is never called.
 */
export async function toMatchUIBaseline(
  this: ExpectMatcherState,
  target: BrowserTarget,
  name: string,
  options: PlaywrightBaselineOptions,
): Promise<MatcherReturnType> {
  return runUIAssertion.call(this, target, {}, options, 'toMatchUIBaseline', undefined, {
    name,
    options,
  });
}

/**
 * Waits for a sampled stable window; negation waits for an observed change.
 * @evidence docs/spec.md#browser-sustained-stability Uses native polling deadlines and shared artifacts while preventing an incomplete window from satisfying either polarity.
 * @evidenceReview docs/spec.md#browser-sustained-stability #e0157b2 Read the revised value-only contract, observer call, pending polarity guard and last anchor diagnostics.
 */
export async function toBeStableUI(
  this: ExpectMatcherState,
  target: BrowserTarget,
  options: PlaywrightStabilityOptions = {},
): Promise<MatcherReturnType> {
  return runUIAssertion.call(this, target, {}, options, 'toBeStableUI', options);
}

async function runUIAssertion(
  this: ExpectMatcherState,
  target: BrowserTarget,
  checks: BrowserCheckOptions,
  options: PlaywrightMatchOptions,
  matcher: 'toMatchUI' | 'toBeStableUI' | 'toMatchUIBaseline',
  stability?: PlaywrightStabilityOptions,
  baseline?: { readonly name: string; readonly options: PlaywrightBaselineOptions },
): Promise<MatcherReturnType> {
  const info = activeTestInfo();
  const name = `slicewright-${randomUUID()}`;
  const observation: {
    actual?: BrowserSnapshot;
    report?: BrowserReport;
    attempt?: number;
    failure?: { readonly error: unknown };
  } = {};
  let artifactChecks = checks;
  let attempts = 0;
  let observing = true;
  let polling = false;
  let timeout = this.timeout ?? 5000;
  let baselinePath: string | undefined;
  let baselineChecks: BrowserCheckOptions | undefined;
  try {
    typia.assert<PlaywrightMatchOptions>(options);
    if (baseline !== undefined) {
      typia.assert<PlaywrightBaselineOptions>(baseline.options);
      if (typeof baseline.name !== 'string' || baseline.name.trim().length === 0) {
        throw new TypeError('UI baseline snapshot name must be a nonempty string.');
      }
      baselinePath = info.snapshotPath(baseline.name);
    }
    const observeStability = stability === undefined
      ? undefined
      : createStabilityObserver(stability);
    timeout = options.timeout ?? timeout;
    positive(timeout, 'UI assertion timeout');
    if (options.intervals !== undefined) {
      if (options.intervals.length === 0) {
        throw new RangeError('UI assertion intervals must be a nonempty list.');
      }
      for (const interval of options.intervals) {
        positive(interval, 'UI assertion interval');
      }
    }
    if (typeof target?.capture !== 'function') {
      throw new TypeError(`${matcher} requires a BrowserTarget with a capture operation.`);
    }
    polling = true;
    // Playwright bounds even an in-flight capture by the remaining test budget.
    // Its poll callback exceptions propagate; only the boolean assertion retries.
    await baseExpect.configure({ soft: false }).poll(async () => {
      try {
        attempts += 1;
        if (baseline !== undefined && baselinePath !== undefined && baselineChecks === undefined) {
          const reference = await loadBrowserBaseline(baselinePath, {
            environment: baseline.options.environment,
          });
          if (!observing) {
            return this.isNot;
          }
          baselineChecks = { ...baseline.options.checks, reference };
        }
        const currentChecks = baselineChecks ?? checks;
        artifactChecks = currentChecks;
        const captured = await target.capture();
        // A timed-out capture cannot update the final observation afterwards.
        if (!observing) {
          return this.isNot;
        }
        const stable = observeStability?.(captured, performance.now());
        const checked = stable?.report ?? checkSnapshot(captured, currentChecks);
        artifactChecks = stable === undefined ? currentChecks : { reference: stable.reference };
        observation.actual = captured;
        observation.report = checked;
        observation.attempt = attempts;
        return stable?.pending === true ? this.isNot : checked.ok;
      } catch (error) {
        const failure = captureError(error);
        if (observing) {
          observation.failure = { error: failure };
        }
        throw failure;
      }
    }, {
      timeout,
      ...(options.intervals === undefined ? {} : { intervals: [...options.intervals] }),
    }).toBe(!this.isNot);
  } catch (error) {
    observing = false;
    const observationFailure = observation.failure;
    const artifactFailure = await attachFailure(
      info,
      name,
      observation.actual,
      observation.report,
      artifactChecks,
      {
        matcher,
        negated: this.isNot,
        timeout,
        attempts,
        observation: observation.actual === undefined ? 'unavailable' : 'last-valid-capture',
        lastValidAttempt: observation.attempt ?? null,
        error: describeError(error),
        ...(baselinePath === undefined ? {} : {
          baseline: { path: baselinePath, environment: baseline?.options.environment },
        }),
      },
    );
    if (!polling || observationFailure !== undefined) {
      const original = observationFailure?.error ?? error;
      if (artifactFailure !== undefined) {
        info.annotations.push({ type: 'slicewright-artifacts', description: artifactFailure });
        try {
          if (original instanceof Error) {
            original.message += `\n${artifactFailure}`;
          }
        } catch {
          // Keep frozen errors intact; the annotation retains the artifact failure.
        }
      }
      // Never convert capture or validation exceptions to a negatable result.
      throw original;
    }
    const findings = observation.report?.findings.map(
      ({ code, message }) => `- ${code}: ${message}`,
    );
    return {
      name: matcher,
      pass: this.isNot,
      actual: observation.report,
      expected: artifactChecks,
      timeout,
      message: () => [
        `Expected browser UI ${this.isNot ? 'not ' : ''}${matcher === 'toBeStableUI' ? 'to remain visually stable.' : 'to match the supplied checks.'}`,
        describeError(error),
        ...(baselinePath === undefined ? [] : [`Baseline: ${baselinePath}`]),
        ...(findings ?? []),
        ...(artifactFailure === undefined ? [] : [artifactFailure]),
      ].join('\n'),
    };
  }
  observing = false;
  return { name: matcher, pass: !this.isNot, message: () => '' };
}

/** Playwright's ordinary expect API extended with observation-only UI assertions. */
export const expect = baseExpect.extend({ toMatchUI, toBeStableUI, toMatchUIBaseline });

function activeTestInfo(): TestInfo {
  try {
    return test.info();
  } catch (cause) {
    throw new Error('slicewright/playwright assertions require an active Playwright Test.', {
      cause,
    });
  }
}

function positive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be finite and positive.`);
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function captureError(error: unknown): Error {
  if (error instanceof Error && Object.isExtensible(error)) {
    return error;
  }
  // Playwright annotates errors with step metadata. Preserve immutable errors
  // and other thrown values as a cause instead of letting that annotation fail.
  const wrapped = new Error(error instanceof Error ? error.message : String(error), {
    cause: error,
  });
  if (error instanceof Error) {
    wrapped.name = error.name;
  }
  return wrapped;
}

async function attachFailure(
  info: TestInfo,
  name: string,
  actual: BrowserSnapshot | undefined,
  report: BrowserReport | undefined,
  checks: BrowserCheckOptions,
  diagnostic: Readonly<Record<string, unknown>>,
): Promise<string | undefined> {
  try {
    await info.attach(`${name}-assertion`, {
      body: `${JSON.stringify({ ok: false, ...diagnostic }, null, 2)}\n`,
      contentType: 'application/json',
    });
    if (actual === undefined || report === undefined) {
      return undefined;
    }
    const paths = await writeBrowserArtifacts(info.outputPath(name), {
      actual,
      report,
      assertion: {
        matcher: String(diagnostic.matcher),
        negated: diagnostic.negated === true,
        error: String(diagnostic.error),
      },
      ...(checks.reference === undefined ? {} : { reference: checks.reference }),
      ...(checks.changedFrom === undefined ? {} : { changedFrom: checks.changedFrom }),
    });
    for (const [kind, path] of Object.entries(paths)) {
      await info.attach(`${name}-${kind}`, {
        path,
        contentType: kind === 'report' ? 'application/json' : 'image/png',
      });
    }
    const html = await writeBrowserReportHtml(
      info.outputPath(name),
      info.outputPath(name, 'report.html'),
    );
    await info.attach(`${name}-html`, { path: html.path, contentType: 'text/html' });
    return undefined;
  } catch (error) {
    return `Unable to attach slicewright failure artifacts: ${describeError(error)}`;
  }
}
