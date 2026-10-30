import { deepStrictEqual, match, ok, strictEqual } from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import typia from 'typia';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browserNames = ['chromium', 'firefox', 'webkit'] as const;
type BrowserName = (typeof browserNames)[number];
const preparedSnapshotCases = new Set([
  'artifact failures preserve the original failure',
  'fails: project timeout keeps final observation and artifacts',
  'fails: configured timeout respects negation',
  'fails: soft matcher continues after two failures',
  'fails: concurrent assertions retain distinct artifacts',
]);

interface Attachment {
  readonly name: string;
  readonly contentType: string;
  readonly path?: string;
  readonly body?: string;
}

interface RunnerResult {
  readonly status: string;
  readonly errors: readonly { readonly message?: string }[];
  readonly attachments: readonly Attachment[];
}

interface RunnerSpec {
  readonly title: string;
  readonly tests: readonly {
    readonly projectName: BrowserName;
    readonly results: readonly RunnerResult[];
  }[];
}

interface RunnerSuite {
  readonly suites?: readonly RunnerSuite[];
  readonly specs?: readonly RunnerSpec[];
}

interface RunnerReport {
  readonly suites: readonly RunnerSuite[];
  readonly errors: readonly unknown[];
  readonly stats: {
    readonly expected: number;
    readonly unexpected: number;
    readonly skipped: number;
    readonly flaky: number;
  };
}

interface ConsumerProbe {
  readonly captures?: number;
  readonly actions?: number;
  readonly observationSource?: 'captured-once';
  readonly matcherActions?: number;
  readonly elapsed?: number;
  readonly timeout?: number;
  readonly continued?: boolean;
  readonly errors?: number;
  readonly rejected?: number;
  readonly artifactFailures?: number;
  readonly captureErrors?: number;
  readonly timeoutDiagnostic?: boolean;
  readonly lateTimeouts?: number;
  readonly delayedAttachments?: number;
}

interface ObservationReport {
  readonly ok: boolean;
  readonly findings: readonly { readonly code: string }[];
  readonly actual: {
    readonly measurement: {
      readonly content?: Readonly<Record<string, { readonly text?: string }>>;
    };
  };
}

export interface PlaywrightConsumerReport {
  readonly baselineWorkflow: { readonly approved: number; readonly compared: number; readonly rejected: number };
  readonly passed: number;
  readonly negativeControls: number;
  readonly attachments: number;
  readonly cases: readonly {
    readonly browser: BrowserName;
    readonly name: string;
    readonly rejected: boolean;
  }[];
  readonly browsers: readonly {
    readonly name: BrowserName;
    readonly version: string;
    readonly passed: number;
    readonly negativeControls: number;
    readonly attachments: number;
  }[];
  readonly output: string;
}

function npmCli(): string {
  const nodeDirectory = dirname(process.execPath);
  const cli = [
    join(nodeDirectory, 'node_modules/npm/bin/npm-cli.js'),
    resolve(nodeDirectory, '../lib/node_modules/npm/bin/npm-cli.js'),
  ].find((candidate) => existsSync(candidate));
  if (cli === undefined) {
    throw new Error('playwright:check requires a Node installation that includes npm.');
  }
  return cli;
}

async function run(
  args: string[],
  cwd: string,
  env = process.env,
  expectedExit = 0,
  timeout = 180_000,
): Promise<void> {
  let exitCode = 0;
  let details = '';
  try {
    const result = await execute(process.execPath, args, {
      cwd,
      env,
      maxBuffer: 16 * 1024 * 1024,
      timeout,
      windowsHide: true,
    });
    details = `${result.stdout}\n${result.stderr}`;
  } catch (error) {
    const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
    exitCode = failure.code ?? -1;
    details = `${failure.message}\n${failure.stdout ?? ''}\n${failure.stderr ?? ''}`;
  }
  strictEqual(exitCode, expectedExit, details);
}

async function installedVersion(name: string): Promise<string> {
  return typia.assert<{ version: string }>(
    JSON.parse(await readFile(require.resolve(`${name}/package.json`), 'utf8')),
  ).version;
}

function allSpecs(suites: readonly RunnerSuite[]): readonly RunnerSpec[] {
  return suites.flatMap((suite) => [...(suite.specs ?? []), ...allSpecs(suite.suites ?? [])]);
}

async function attachmentBytes(attachment: Attachment): Promise<Buffer> {
  if (attachment.path !== undefined) {
    return readFile(attachment.path);
  }
  ok(attachment.body !== undefined, `${attachment.name}: attachment must contain bytes.`);
  return Buffer.from(attachment.body, 'base64');
}

async function probeFor(result: RunnerResult): Promise<ConsumerProbe> {
  const attachment = result.attachments.find((entry) => entry.name === 'consumer-probe');
  ok(attachment, 'Consumer execution must reach its probe.');
  return typia.assert<ConsumerProbe>(
    JSON.parse((await attachmentBytes(attachment)).toString('utf8')),
  );
}

async function verifiesBaselineWorkflow(consumer: string, output: string): Promise<PlaywrightConsumerReport['baselineWorkflow']> {
  const example = join(consumer, 'baseline-workflow');
  await cp(join(root, 'examples/baseline-workflow'), example, {
    recursive: true,
    filter: (path) => !['node_modules', 'baselines', 'test-results', 'playwright-report'].includes(basename(path)),
  });
  const baselineDirectory = join(example, 'baselines');
  const exampleOutput = join(output, 'baseline-workflow');
  await mkdir(exampleOutput, { recursive: true });
  async function phase(name: string, mode: string, failures: number, total: number, args: string[] = []): Promise<RunnerReport> {
    const reportPath = join(exampleOutput, `${name}.json`);
    await run(
      [join(example, 'run.mjs'), mode, ...args],
      example,
      {
        ...process.env,
        SLICEWRIGHT_EXAMPLE_REPORT: reportPath,
        SLICEWRIGHT_EXAMPLE_OUTPUT: join(exampleOutput, name),
        SLICEWRIGHT_EXAMPLE_FAULT: name === 'regression' ? 'paint' : '',
      },
      failures ? 1 : 0,
      360_000,
    );
    const report = typia.assert<RunnerReport>(JSON.parse(await readFile(reportPath, 'utf8')));
    deepStrictEqual(report.errors, []);
    strictEqual(report.stats.expected, total - failures);
    strictEqual(report.stats.unexpected, failures);
    strictEqual(report.stats.skipped, 0);
    strictEqual(report.stats.flaky, 0);
    const specs = allSpecs(report.suites);
    strictEqual(specs.length * browserNames.length, total);
    for (const spec of specs) {
      deepStrictEqual(
        spec.tests.map((entry) => entry.projectName).sort(),
        [...browserNames].sort(),
      );
      for (const entry of spec.tests) {
        strictEqual(entry.results.length, 1);
        strictEqual(entry.results[0]?.status, failures ? 'failed' : 'passed');
      }
    }
    return report;
  }
  async function fingerprints(): Promise<Record<string, string>> {
    const paths = (await readdir(baselineDirectory, { recursive: true })).sort();
    const result: Record<string, string> = {};
    for (const path of paths) {
      if (path.endsWith('.json') || path.endsWith('.png')) {
        result[path] = createHash('sha256').update(await readFile(join(baselineDirectory, path))).digest('hex');
      }
    }
    return result;
  }
  await phase('missing', 'test', 3, 3, ['--grep', 'dom wide-en approved', '--update-snapshots']);
  strictEqual(
    existsSync(baselineDirectory),
    false,
    'Update mode must not create missing baselines.',
  );
  await phase('approval', 'approve', 0, 24);
  const approved = await fingerprints();
  strictEqual(Object.keys(approved).filter((path) => path.endsWith('.json')).length, 48);
  strictEqual(Object.keys(approved).filter((path) => path.endsWith('.png')).length, 48);
  await phase('comparison', 'test', 0, 24, ['--update-snapshots']);
  deepStrictEqual(await fingerprints(), approved);
  const negative = await phase('regression', 'test', 3, 3, [
    '--grep',
    'canvas narrow-ko-large approved',
  ]);
  deepStrictEqual(
    await fingerprints(),
    approved,
    'A real painted regression must not update references.',
  );
  for (const spec of allSpecs(negative.suites)) {
    for (const entry of spec.tests) {
      const result = entry.results[0];
      ok(result);
      const attachment = result.attachments.find((item) => item.name.endsWith('-report'));
      ok(attachment);
      const report = typia.assert<ObservationReport>(
        JSON.parse((await attachmentBytes(attachment)).toString('utf8')),
      );
      const pixelCode = process.platform === 'win32' && entry.projectName === 'firefox'
        ? 'browser.pixels-outside'
        : 'browser.pixels';
      ok(report.findings.some((finding) => finding.code === pixelCode));
      ok(result.attachments.some((item) => item.name.endsWith('-html')));
    }
  }
  // Keep the approved images as inspectable evidence after removing the consumer.
  await cp(baselineDirectory, join(exampleOutput, 'baselines'), { recursive: true });
  return { approved: 24, compared: 24, rejected: 6 };
}

async function verifyRunner(report: RunnerReport, output: string): Promise<{
  cases: { browser: BrowserName; name: string; rejected: boolean }[];
  browsers: PlaywrightConsumerReport['browsers'];
  attachments: number;
}> {
  deepStrictEqual(report.errors, [], 'Runner setup and teardown must succeed.');
  const specs = allSpecs(report.suites);
  const failures = specs.flatMap((spec) => spec.tests.flatMap((test) => test.results
    .filter((result) => result.status !== (spec.title.startsWith('fails:') ? 'failed' : 'passed'))
    .map((result) => `[${test.projectName}] ${spec.title}: ${result.errors.map((error) => error.message ?? '').join('\n')}`),
  )).join('\n');
  deepStrictEqual(
    report.stats,
    {
      ...report.stats,
      expected: 69,
      unexpected: 36,
      flaky: 0,
      skipped: 0,
    },
    failures,
  );
  strictEqual(specs.length, 35, 'Every intended consumer case must actually execute.');
  const executions = specs.flatMap((spec) => {
    deepStrictEqual(
      spec.tests.map((test) => test.projectName).sort(),
      [...browserNames].sort(),
      `${spec.title}: every browser project must execute exactly once.`,
    );
    return spec.tests.map((test) => ({ title: spec.title, ...test }));
  });
  strictEqual(executions.length, 105);
  const cases: { browser: BrowserName; name: string; rejected: boolean }[] = [];
  const versions = new Map<BrowserName, string>();
  const browserAttachments = new Map<BrowserName, number>();
  const artifactNames = new Set<string>();
  const artifactPaths = new Set<string>();
  for (const spec of executions) {
    const label = `[${spec.projectName}] ${spec.title}`;
    const results = spec.results;
    strictEqual(results.length, 1, `${label}: runner retries must be disabled.`);
    const result = results[0];
    ok(result);
    const rejected = spec.title.startsWith('fails:');
    strictEqual(result.status, rejected ? 'failed' : 'passed', label);
    cases.push({ browser: spec.projectName, name: spec.title, rejected });
    if (spec.title.startsWith('public interaction')) {
      const identity = result.attachments.find((entry) => entry.name === 'consumer-browser');
      ok(identity, `${label}: actual browser identity must be reported.`);
      const browser = typia.assert<{
        name: BrowserName;
        version: string;
        initialCaptureAttempts: number;
      }>(JSON.parse((await attachmentBytes(identity)).toString('utf8')));
      strictEqual(
        browser.name,
        spec.projectName,
        `${label}: project must launch the requested engine.`,
      );
      ok(browser.version.length > 0);
      ok(
        Number.isInteger(browser.initialCaptureAttempts) &&
        browser.initialCaptureAttempts >= 2 && browser.initialCaptureAttempts <= 5,
        `${label}: initial reference must settle within two to five captures.`,
      );
      const prior = versions.get(browser.name);
      if (prior !== undefined) {
        strictEqual(browser.version, prior, `${label}: browser version must be consistent.`);
      }
      versions.set(browser.name, browser.version);
    }
    const artifacts = result.attachments.filter((entry) => entry.name.startsWith('slicewright-'));
    browserAttachments.set(
      spec.projectName,
      (browserAttachments.get(spec.projectName) ?? 0) + artifacts.length,
    );
    for (const artifact of artifacts) {
      ok(!artifactNames.has(artifact.name), `${label}: duplicate attachment name.`);
      artifactNames.add(artifact.name);
      if (artifact.path !== undefined) {
        ok(!artifactPaths.has(artifact.path), `${label}: artifact path collision.`);
        artifactPaths.add(artifact.path);
        const path = relative(join(output, 'test-results', spec.projectName), artifact.path);
        ok(
          path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path),
          `${label}: artifact must stay in its browser directory.`,
        );
      }
      const bytes = await attachmentBytes(artifact);
      ok(bytes.length > 0);
      if (artifact.contentType === 'image/png') {
        deepStrictEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
        ok(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0);
      }
    }
    const htmlReports = artifacts.filter((entry) => entry.name.endsWith('-html'));
    const jsonReports = artifacts.filter((entry) => entry.name.endsWith('-report'));
    strictEqual(
      htmlReports.length,
      jsonReports.length - (spec.title.startsWith('artifact failures') ? 1 : 0),
      `${label}: every valid observation needs an HTML report.`,
    );
    for (const html of htmlReports) {
      strictEqual(html.contentType, 'text/html');
      match((await attachmentBytes(html)).toString('utf8'), /<!doctype html>/);
    }
    if (preparedSnapshotCases.has(spec.title)) {
      const probe = await probeFor(result);
      strictEqual(
        probe.observationSource,
        'captured-once',
        `${label}: timed callbacks must use prepared real snapshots.`,
      );
      strictEqual(probe.matcherActions, 0, `${label}: the matcher must only observe.`);
      ok(
        probe.captures !== undefined && probe.captures > 1,
        `${label}: timed callbacks must retry.`,
      );
      for (const assertion of artifacts.filter((entry) => entry.name.endsWith('-assertion'))) {
        const diagnostic = typia.assert<{
          attempts: number;
          observation: 'last-valid-capture';
          lastValidAttempt: number;
        }>(JSON.parse((await attachmentBytes(assertion)).toString('utf8')));
        ok(diagnostic.attempts > 1, `${label}: each assertion must retry its capture callback.`);
        ok(
          diagnostic.lastValidAttempt > 1,
          `${label}: each assertion must complete repeated captures.`,
        );
      }
    }
    if (!rejected) {
      if (spec.title.startsWith('capture exceptions')) {
        const diagnostics = artifacts.filter((entry) => entry.name.endsWith('-assertion'));
        strictEqual(diagnostics.length, 3);
        const details = await Promise.all(
          diagnostics.map(async (attachment) =>
            typia.assert<{ error: string; attempts: number; lastValidAttempt: number | null }>(
              JSON.parse((await attachmentBytes(attachment)).toString('utf8')),
            ),
          ),
        );
        deepStrictEqual(
          details.map((entry) => entry.attempts),
          [1, 1, 2],
        );
        deepStrictEqual(
          details.map((entry) => entry.lastValidAttempt),
          [null, null, 1],
        );
        match(details[2]?.error ?? '', /consumer second capture failed/);
      } else if (spec.title.startsWith('baseline invalid')) {
        strictEqual(artifacts.length, 12);
        ok(artifacts.every((entry) => entry.name.endsWith('-assertion')));
      } else if (spec.title.startsWith('baseline load deadline')) {
        strictEqual(artifacts.length, 2);
        for (const attachment of artifacts) {
          const diagnostic = typia.assert<{ observation: string; attempts: number; matcher: string }>(
            JSON.parse((await attachmentBytes(attachment)).toString('utf8')),
          );
          strictEqual(diagnostic.observation, 'unavailable');
          strictEqual(diagnostic.attempts, 1);
          strictEqual(diagnostic.matcher, 'toMatchUIBaseline');
        }
      } else if (spec.title.startsWith('stability invalid')) {
        strictEqual(artifacts.length, 6);
        ok(artifacts.every((entry) => entry.name.endsWith('-assertion')));
      } else if (spec.title.startsWith('invalid options')) {
        strictEqual(artifacts.length, 20);
        ok(artifacts.every((entry) => entry.name.endsWith('-assertion')));
      } else if (spec.title.startsWith('artifact failures')) {
        strictEqual(
          artifacts.length,
          3,
          'JSON and PNG diagnostics survive an HTML attachment failure.',
        );
        strictEqual(htmlReports.length, 0);
      } else if (spec.title.startsWith('late capture errors')) {
        strictEqual(artifacts.length, 2);
        ok(artifacts.every((entry) => entry.name.endsWith('-assertion')));
        const probe = await probeFor(result);
        strictEqual(probe.lateTimeouts, 2);
        strictEqual(probe.delayedAttachments, 2);
      } else {
        strictEqual(
          artifacts.length,
          0,
          `${spec.title}: successful matches need no failure artifacts.`,
        );
      }
      if (spec.title.startsWith('artifact failures')) {
        const probe = await probeFor(result);
        strictEqual(probe.artifactFailures, 8);
        strictEqual(probe.captureErrors, 6);
        strictEqual(probe.timeoutDiagnostic, true);
      }
      continue;
    }
    const messages = result.errors.map((error) => error.message ?? '').join('\n');
    match(messages, /Expected browser UI|toMatchUI/);
    const reports = artifacts.filter((entry) => /-report(?:\.json)?$/.test(entry.name));
    const assertions = artifacts.filter((entry) => /-assertion(?:\.json)?$/.test(entry.name));
    const actuals = artifacts.filter((entry) => /-actual(?:\.png)?$/.test(entry.name));
    const probe = await probeFor(result);
    if (spec.title.includes('hanging capture')) {
      strictEqual(actuals.length, 0, 'An unavailable capture must not create fake pixels.');
      strictEqual(reports.length, 0, 'An unavailable capture must not claim a valid observation.');
      strictEqual(assertions.length, 1, 'An unavailable capture must retain a diagnostic report.');
      strictEqual(
        artifacts.length,
        1,
        'An unavailable capture must retain a diagnostic JSON attachment.',
      );
      strictEqual(artifacts[0]?.contentType, 'application/json');
      const diagnostic = assertions[0];
      ok(diagnostic);
      const details = typia.assert<{
        ok: false;
        matcher: 'toMatchUI';
        attempts: number;
        timeout: number;
        observation: 'unavailable';
        lastValidAttempt: null;
        error: string;
      }>(JSON.parse((await attachmentBytes(diagnostic)).toString('utf8')));
      strictEqual(details.attempts, 1, 'The deadline must interrupt an in-flight capture.');
      const remainingBudget = spec.title.includes('remaining test budget');
      const timeout = remainingBudget ? 5000 : 250;
      strictEqual(
        details.timeout,
        timeout,
        'Diagnostics must retain the requested matcher timeout.',
      );
      strictEqual(probe.timeout, timeout, 'The probe must identify the tested matcher timeout.');
      const reason = remainingBudget ? /Test timeout of 2000ms exceeded/ : /Timeout 250ms exceeded/;
      match(details.error, reason);
      match(messages, reason);
      ok(probe.elapsed !== undefined);
      if (remainingBudget) {
        ok(
          probe.elapsed >= 1250 && probe.elapsed < 3000,
          'The test budget must cut off the 5000 ms matcher after capture has started.',
        );
      } else {
        ok(
          probe.elapsed >= 175 && probe.elapsed < 1000,
          'The 250 ms matcher deadline must interrupt the pending capture.',
        );
      }
      continue;
    }
    const count = spec.title.includes('soft matcher') || spec.title.includes('concurrent') ? 2 : 1;
    strictEqual(
      assertions.length,
      count,
      `${spec.title}: each failure needs assertion diagnostics.`,
    );
    strictEqual(
      reports.length,
      count,
      `${spec.title}: each failed assertion needs its own report.`,
    );
    strictEqual(actuals.length, count, `${spec.title}: each failed assertion needs its own image.`);
    if (spec.title.startsWith('fails: baseline')) {
      strictEqual(artifacts.length, count * 6);
      ok(probe.captures !== undefined && probe.captures > 1);
      strictEqual(probe.actions, 0);
      for (const assertion of assertions) {
        const diagnostic = typia.assert<{
          matcher: string; baseline: { path: string; environment: string }; attempts: number;
        }>(JSON.parse((await attachmentBytes(assertion)).toString('utf8')));
        strictEqual(diagnostic.matcher, 'toMatchUIBaseline');
        ok(diagnostic.baseline.path.includes(spec.projectName));
        ok(diagnostic.baseline.path.includes('approved'));
        ok(diagnostic.baseline.environment.includes(spec.projectName));
        ok(diagnostic.attempts > 1);
      }
      for (const attachment of reports) {
        const final = typia.assert<ObservationReport>(
          JSON.parse((await attachmentBytes(attachment)).toString('utf8')),
        );
        strictEqual(final.ok, spec.title.includes('negation'));
        if (!final.ok) {
          ok(final.findings.some((finding) => finding.code === 'browser.pixels'));
        }
      }
      strictEqual(artifacts.filter((entry) => entry.name.endsWith('-expected')).length, count);
      strictEqual(artifacts.filter((entry) => entry.name.endsWith('-diff')).length, count);
    }
    if (spec.title.startsWith('fails: stability')) {
      strictEqual(artifacts.length, 6);
      const attachment = reports[0];
      ok(attachment);
      const final = typia.assert<ObservationReport>(
        JSON.parse((await attachmentBytes(attachment)).toString('utf8')),
      );
      strictEqual(final.ok, spec.title.includes('stable negation'));
      if (spec.title.includes('pending')) {
        ok(final.findings.some((finding) => finding.code === 'browser.stability-pending'));
      }
      if (spec.title.includes('drift')) {
        ok(final.findings.some((finding) => finding.code === 'browser.pixels'));
      }
      ok(probe.captures !== undefined && probe.captures > 1);
      strictEqual(probe.actions, 0);
      ok(probe.elapsed !== undefined && probe.elapsed >= 175 && probe.elapsed < 1750);
      ok(artifacts.some((entry) => entry.name.endsWith('-expected')));
      ok(artifacts.some((entry) => entry.name.endsWith('-diff')));
    }
    if (spec.title.includes('project timeout')) {
      const reportAttachment = reports[0];
      ok(reportAttachment);
      const final = typia.assert<ObservationReport>(
        JSON.parse((await attachmentBytes(reportAttachment)).toString('utf8')),
      );
      strictEqual(final.ok, false);
      strictEqual(final.actual.measurement.content?.label?.text, 'Ready');
      ok(final.findings.some((finding) => finding.code === 'browser.text'));
      ok(final.findings.some((finding) => finding.code === 'browser.pixels'));
      ok(artifacts.some((entry) => /-expected(?:\.png)?$/.test(entry.name)));
      ok(artifacts.some((entry) => /-diff(?:\.png)?$/.test(entry.name)));
      ok(probe.captures !== undefined && probe.captures > 2);
      strictEqual(probe.actions, 1, 'Retries must not repeat the caller action.');
    }
    if (spec.title.includes('configured timeout')) {
      const reportAttachment = reports[0];
      ok(reportAttachment);
      const final = typia.assert<ObservationReport>(
        JSON.parse((await attachmentBytes(reportAttachment)).toString('utf8')),
      );
      strictEqual(
        final.ok,
        true,
        'Negation must fail when the observed positive contract still matches.',
      );
      ok(probe.captures !== undefined && probe.captures > 1);
    }
    if (spec.title.includes('timeout')) {
      ok(probe.elapsed !== undefined && probe.timeout !== undefined);
      ok(
        probe.elapsed >= probe.timeout * 0.7,
        'A valid mismatch must retry until near its configured deadline.',
      );
      ok(
        probe.elapsed < probe.timeout + 1500,
        'Expect configuration must override the default timeout.',
      );
    }
    if (spec.title.includes('soft matcher')) {
      strictEqual(probe.continued, true);
      strictEqual(probe.errors, 2, 'Both soft failures must be reported while the test continues.');
      strictEqual(result.errors.length, 2);
    }
    if (spec.title.includes('concurrent')) {
      strictEqual(probe.rejected, 2);
    }
  }
  const browsers = browserNames.map((name) => {
    const entries = cases.filter((entry) => entry.browser === name);
    strictEqual(entries.length, 35, `${name}: complete matcher suite required.`);
    const passed = entries.filter((entry) => !entry.rejected).length;
    const negativeControls = entries.filter((entry) => entry.rejected).length;
    const attachments = browserAttachments.get(name) ?? 0;
    strictEqual(passed, 23, name);
    strictEqual(negativeControls, 12, name);
    strictEqual(attachments, 121, `${name}: expected every independent assertion artifact.`);
    const version = versions.get(name);
    ok(version, `${name}: actual browser version required.`);
    return { name, version, passed, negativeControls, attachments };
  });
  strictEqual(artifactNames.size, 363);
  return { cases, browsers, attachments: artifactNames.size };
}

/**
 * Installs the tarball outside the repository and verifies real Playwright Test
 * semantics through public imports, including intentionally failing child tests.
 *
 * @evidence docs/spec.md#playwright-baseline-assertions Runs installed DOM and Canvas baselines, custom snapshot paths, update-mode immutability, invalid inputs, bounded loading, polling, negation and soft failures with real runner artifacts.
 * @evidenceReview docs/spec.md#playwright-baseline-assertions #528d222 Ran 105 installed matcher outcomes with 363 attachments and 42 HTML reports, then the clean installed example: 24 approvals, 24 comparisons and six expected failures with unchanged baseline fingerprints; inspected narrow Korean 200-percent DOM and Canvas images.
 * @evidence docs/spec.md#browser-sustained-stability Checks live DOM and Canvas settling, observed drift, pending negation, validation, native deadlines and compared-anchor failure artifacts in all engines.
 * @evidenceReview docs/spec.md#browser-sustained-stability #e0157b2 Ran the installed three-engine suite with null-prototype pending-negation metadata: all 84 expected outcomes, 249 attachments and 30 offline HTML reports passed, preserving deadline and pending-polarity guards.
 * @evidence docs/spec.md#browser-failure-context Verifies one offline HTML attachment per valid failed observation, rendering context, negation status and no external requests in all three engines.
 * @evidenceReview docs/spec.md#browser-failure-context #0d2038e Ran the packed three-engine suite with 63 expected outcomes, 177 unique attachments and 21 offline HTML reports; checked failed negation, concurrent failures, missing captures and preserved JSON/PNG after HTML attachment errors.
 * @evidence docs/spec.md#browser-regional-pixel-policies Runs public regional options through the real matcher for DOM and Canvas on every browser, with rendered inside and outside controls.
 * @evidenceReview docs/spec.md#browser-regional-pixel-policies #17cfb4a Ran the clean installed three-engine Playwright suite with 63 intended outcomes, including all six regional-policy matcher cases, and 147 unique failure attachments.
 * @evidence docs/spec.md#playwright-test-integration Exercises installed declarations, optional-peer isolation, retrying DOM and Canvas checks, real input exactly once, negation, soft assertions, deadlines, invalid input, and isolated runner attachments.
 * @evidenceReview docs/spec.md#playwright-test-integration #4274194 Read the contract and timed probes using clones of real snapshots captured before their deadlines, repeated completed callback checks and action rejection; ran the packed three-engine consumer with 51 expected outcomes and 147 artifacts, including unchanged live interaction and delayed-render checks and strict native deadline diagnostics.
 * @evidence docs/spec.md#browser-engine-compatibility Runs each installed public matcher scenario in Chromium, Firefox, and WebKit projects, validates actual engine identity and independent outcomes, and checks globally unique artifacts within each engine directory.
 * @evidenceReview docs/spec.md#browser-engine-compatibility #d7e3d78 Re-read the compatibility contract, three-project checks, strict matcher references, and the completed macOS report with 51 expected outcomes and 147 unique attachments; the separate baseline fixture allowance does not change these matcher comparisons or deadline probes.
 */
export async function verifiesPackedPlaywrightConsumer(): Promise<PlaywrightConsumerReport> {
  ok(existsSync(join(root, 'dist/playwright.js')), 'Run pnpm build before pnpm playwright:check.');
  const consumer = await mkdtemp(join(tmpdir(), 'slicewright-playwright-consumer-'));
  const output = join(root, '.slicewright/playwright-e2e');
  const npm = npmCli();
  try {
    await rm(output, { recursive: true, force: true });
    await mkdir(output, { recursive: true });
    await run([npm, 'pack', '--ignore-scripts', '--pack-destination', consumer], root);
    const tarballs = (await readdir(consumer)).filter((file) => file.endsWith('.tgz'));
    strictEqual(tarballs.length, 1);
    const tarball = tarballs[0];
    ok(tarball);
    const packageJson = {
      name: 'slicewright-playwright-consumer',
      private: true,
      type: 'module',
      dependencies: { slicewright: `file:./${tarball}` },
    };
    await writeFile(join(consumer, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
    const install = [
      npm,
      'install',
      '--ignore-scripts',
      '--no-package-lock',
      '--no-audit',
      '--no-fund',
    ];
    await run(install, consumer);
    await run(['--input-type=module', '-e', `
      import { throws } from 'node:assert/strict';
      import { createRequire } from 'node:module';
      const require = createRequire(import.meta.url);
      for (const peer of ['playwright-core', '@playwright/test']) {
        throws(() => require.resolve(peer), { code: 'MODULE_NOT_FOUND' });
      }
      await import('slicewright');
      await import('slicewright/browser');
    `], consumer);
    await run([join(consumer, 'node_modules/slicewright/dist/cli.js'), '--help'], consumer);
    await writeFile(join(consumer, 'package.json'), `${JSON.stringify({
      ...packageJson,
      dependencies: {
        ...packageJson.dependencies,
        '@playwright/test': await installedVersion('@playwright/test'),
        '@types/node': await installedVersion('@types/node'),
      },
    }, null, 2)}\n`);
    await run(install, consumer);
    await run(['--input-type=module', '-e', `
      import { existsSync } from 'node:fs';
      import { chromium, firefox, webkit } from '@playwright/test';
      for (const browser of [chromium, firefox, webkit]) {
        if (browser.name() === 'chromium' && process.env.SLICEWRIGHT_CHROME_CHANNEL) continue;
        if (!existsSync(browser.executablePath())) {
          throw new Error('Missing Playwright ' + browser.name() + ' executable. Run ' +
            'pnpm exec playwright install chromium firefox webkit before pnpm playwright:check ' +
            '(on Linux, add --with-deps to install system dependencies).');
        }
      }
    `], consumer);
    await cp(join(root, 'test/playwright-consumer'), consumer, { recursive: true });
    await cp(
      join(root, 'test/browser-e2e/stable-capture.mjs'),
      join(consumer, 'stable-capture.mjs'),
    );
    for (const name of ['focus-consumer.mjs', 'focus.html', 'regions-consumer.mjs']) {
      await cp(join(root, 'test/browser-e2e', name), join(consumer, name));
    }
    await cp(join(root, 'examples/browser-e2e'), join(consumer, 'fixture'), { recursive: true });
    await cp(join(consumer, 'contract.ts.txt'), join(consumer, 'contract.ts'));
    await writeFile(join(consumer, 'tsconfig.json'), `${JSON.stringify({
      compilerOptions: {
        target: 'ES2023', lib: ['ES2023', 'DOM'], module: 'NodeNext', moduleResolution: 'NodeNext',
        strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true,
        noEmit: true, skipLibCheck: false, types: ['node'],
      },
      include: ['contract.ts'],
    }, null, 2)}\n`);
    const compiler = join(dirname(require.resolve('ttsc/package.json')), 'lib/launcher/ttsc.js');
    await run([compiler, '-p', join(consumer, 'tsconfig.json')], consumer);
    await run(['--input-type=module', '-e', `
      import { rejects } from 'node:assert/strict';
      import { expect } from 'slicewright/playwright';
      await rejects(async () => expect({ capture() { throw new Error('must not capture'); } })
        .toMatchUI({}), /Playwright Test/);
    `], consumer);
    const runnerReportPath = join(output, 'runner-report.json');
    await run(
      [join(consumer, 'node_modules/@playwright/test/cli.js'), 'test'],
      consumer,
      {
        ...process.env,
        SLICEWRIGHT_CONSUMER_REPORT: runnerReportPath,
        SLICEWRIGHT_CONSUMER_OUTPUT: join(output, 'test-results'),
      },
      1,
      360_000,
    );
    const runnerReport = typia.assert<RunnerReport>(
      JSON.parse(await readFile(runnerReportPath, 'utf8')),
    );
    const verified = await verifyRunner(runnerReport, output);
    await run([join(consumer, 'inspect-reports.mjs'), runnerReportPath], consumer);
    const baselineWorkflow = await verifiesBaselineWorkflow(consumer, output);
    const report = {
      baselineWorkflow,
      passed: verified.cases.filter((entry) => !entry.rejected).length,
      negativeControls: verified.cases.filter((entry) => entry.rejected).length,
      ...verified,
      output,
    };
    await writeFile(join(output, 'consumer-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
}
