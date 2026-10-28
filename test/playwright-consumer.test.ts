import { deepStrictEqual, match, ok, strictEqual } from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import typia from 'typia';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
  readonly tests: readonly { readonly results: readonly RunnerResult[] }[];
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
  readonly passed: number;
  readonly negativeControls: number;
  readonly attachments: number;
  readonly cases: readonly { readonly name: string; readonly rejected: boolean }[];
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
): Promise<void> {
  let exitCode = 0;
  let details = '';
  try {
    const result = await execute(process.execPath, args, {
      cwd,
      env,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 180_000,
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

async function verifyRunner(report: RunnerReport): Promise<{
  cases: { name: string; rejected: boolean }[];
  attachments: number;
}> {
  deepStrictEqual(report.errors, [], 'Runner setup and teardown must succeed.');
  deepStrictEqual(report.stats, {
    ...report.stats,
    expected: 11,
    unexpected: 6,
    flaky: 0,
    skipped: 0,
  });
  const specs = allSpecs(report.suites);
  strictEqual(specs.length, 17, 'Every intended consumer case must actually execute.');
  const cases: { name: string; rejected: boolean }[] = [];
  const artifactNames = new Set<string>();
  const artifactPaths = new Set<string>();
  for (const spec of specs) {
    strictEqual(spec.tests.length, 1, spec.title);
    const results = spec.tests[0]?.results;
    ok(results);
    strictEqual(results.length, 1, `${spec.title}: runner retries must be disabled.`);
    const result = results[0];
    ok(result);
    const rejected = spec.title.startsWith('fails:');
    strictEqual(result.status, rejected ? 'failed' : 'passed', spec.title);
    cases.push({ name: spec.title, rejected });
    const artifacts = result.attachments.filter((entry) => entry.name.startsWith('slicewright-'));
    for (const artifact of artifacts) {
      ok(!artifactNames.has(artifact.name), `${spec.title}: duplicate attachment name.`);
      artifactNames.add(artifact.name);
      if (artifact.path !== undefined) {
        ok(!artifactPaths.has(artifact.path), `${spec.title}: artifact path collision.`);
        artifactPaths.add(artifact.path);
      }
      const bytes = await attachmentBytes(artifact);
      ok(bytes.length > 0);
      if (artifact.contentType === 'image/png') {
        deepStrictEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
        ok(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0);
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
      } else if (spec.title.startsWith('invalid options')) {
        strictEqual(artifacts.length, 20);
        ok(artifacts.every((entry) => entry.name.endsWith('-assertion')));
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
        strictEqual(probe.artifactFailures, 7);
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
        observation: 'unavailable';
        lastValidAttempt: null;
        error: string;
      }>(JSON.parse((await attachmentBytes(diagnostic)).toString('utf8')));
      match(details.error, /[Tt]imeout|[Tt]imed out/);
      match(messages, /[Tt]imeout|[Tt]imed out/);
      ok(
        probe.elapsed !== undefined && probe.elapsed < 3500,
        'A hung capture must respect its deadline.',
      );
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
  return { cases, attachments: artifactNames.size };
}

/**
 * Installs the tarball outside the repository and verifies real Playwright Test
 * semantics through public imports, including intentionally failing child tests.
 *
 * @evidence docs/spec.md#playwright-test-integration Exercises installed declarations, optional-peer isolation, retrying DOM and Canvas checks, real input exactly once, negation, soft assertions, deadlines, invalid input, and isolated runner attachments.
 * @evidenceReview docs/spec.md#playwright-test-integration #4274194 Read the contract and ran pnpm playwright:check on macOS Chrome: clean optional-peer installation and declarations passed; all 17 runner cases had their expected outcomes and 49 attachments were validated, including late rejection and attachment-failure probes.
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
    await cp(join(root, 'test/playwright-consumer'), consumer, { recursive: true });
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
    );
    const runnerReport = typia.assert<RunnerReport>(
      JSON.parse(await readFile(runnerReportPath, 'utf8')),
    );
    const verified = await verifyRunner(runnerReport);
    const report = { passed: 11, negativeControls: 6, ...verified, output };
    await writeFile(join(output, 'consumer-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
}
