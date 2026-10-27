import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
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

interface BrowserConsumerCase {
  readonly browser: 'chromium' | 'firefox' | 'webkit';
  readonly name: string;
  readonly renderer: 'dom' | 'canvas';
  readonly fault: string;
  readonly initialCaptureAttempts: number;
  readonly rejected: boolean;
  readonly findings: readonly { readonly step: string; readonly code: string }[];
}

interface BrowserEngineConsumerReport {
  readonly browser: 'chromium' | 'firefox' | 'webkit';
  readonly version: string;
  readonly cases: readonly BrowserConsumerCase[];
  readonly passed: number;
  readonly negativeControls: number;
  readonly captureProbes: number;
  readonly baselineRoundTrips: number;
  readonly output: string;
}

export interface BrowserConsumerReport {
  readonly engines: readonly BrowserEngineConsumerReport[];
  readonly cases: readonly BrowserConsumerCase[];
  readonly passed: number;
  readonly negativeControls: number;
  readonly captureProbes: number;
  readonly baselineRoundTrips: number;
  readonly output: string;
}

function npmCli(): string {
  // Node's official Unix and Windows distributions both include npm. Invoke
  // its JS entry point directly so paths with spaces and Windows .cmd shims
  // never require shell interpolation.
  const nodeDirectory = dirname(process.execPath);
  const candidates = [
    join(nodeDirectory, 'node_modules/npm/bin/npm-cli.js'),
    resolve(nodeDirectory, '../lib/node_modules/npm/bin/npm-cli.js'),
  ];
  const cli = candidates.find((candidate) => existsSync(candidate));
  if (cli === undefined) {
    throw new Error('browser:check requires a Node installation that includes npm.');
  }
  return cli;
}

async function run(args: string[], cwd: string, timeout = 180_000): Promise<string> {
  try {
    const result = await execute(process.execPath, args, {
      cwd,
      env: process.env,
      maxBuffer: 16 * 1024 * 1024,
      timeout,
      windowsHide: true,
    });
    return result.stdout;
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    throw new Error(`${failure.message}\n${failure.stdout ?? ''}\n${failure.stderr ?? ''}`, {
      cause: error,
    });
  }
}

async function installedVersion(name: string): Promise<string> {
  const metadata = typia.assert<{ version: string }>(
    JSON.parse(await readFile(require.resolve(`${name}/package.json`), 'utf8')),
  );
  return metadata.version;
}

/**
 * Packs the built package, installs it outside the repository, and runs one
 * public-API scenario against DOM and Canvas renderers with real mouse input.
 *
 * @evidence docs/spec.md#browser-ui-verification Installs the tarball into a clean consumer, type-checks its public declarations, and verifies real browser transitions, explicit content bounds, CSS-scale scroll/DPR captures, and five injected failures on both renderers.
 * @evidenceReview docs/spec.md#browser-ui-verification #9f7e47a Reviewed the public-import scenario and checked the successful macOS Chrome browser:check result: clean core installation without Playwright, installed public declarations, eight DOM/Canvas interaction cases, ten intended fault rejections, and two fractional DPR2 fixed/sticky capture probes.
 * @evidence docs/spec.md#persistent-browser-baselines Saves approved rendered DOM and Canvas baselines through the packed public API, reloads their pixels in another process, and checks initial matches and real activation differences against the restored references.
 * @evidenceReview docs/spec.md#persistent-browser-baselines #2479944 Read the persistence contract and checked the passing packed Chrome consumer: two separate-process DOM/Canvas baseline round-trips, byte equality, initial matches, and activation mismatches; inspected actual, expected, and diff PNGs.
 * @evidence docs/spec.md#browser-engine-compatibility Runs the same packed DOM and Canvas consumer scenarios on Chromium, Firefox, and WebKit, requiring each engine's interaction cases, negative controls, capture probes, and separate-process baseline round-trips with separate artifacts.
 * @evidenceReview docs/spec.md#browser-engine-compatibility #7f2473b Inspected the bounded initial setup: at most five panel captures, two consecutive exactly equal snapshots before approval or input, diagnostics on instability, and per-case attempt assertions; the interaction assertions and matrix counts remain unchanged.
 */
export async function verifiesPackedBrowserConsumer(): Promise<BrowserConsumerReport> {
  ok(existsSync(join(root, 'dist/browser.js')), 'Run pnpm build before pnpm browser:check.');
  const consumer = await mkdtemp(join(tmpdir(), 'slicewright-browser-consumer-'));
  const output = join(root, '.slicewright/browser-e2e');
  const npm = npmCli();
  try {
    await mkdir(output, { recursive: true });
    await run([npm, 'pack', '--ignore-scripts', '--pack-destination', consumer], root);
    const tarballs = (await readdir(consumer)).filter((file) => file.endsWith('.tgz'));
    strictEqual(tarballs.length, 1, 'Expected exactly one packed slicewright tarball.');
    const tarball = tarballs[0];
    ok(tarball);
    const packageJson = {
      name: 'slicewright-browser-consumer',
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
      throws(() => require.resolve('playwright-core'), { code: 'MODULE_NOT_FOUND' });
      await import('slicewright');
    `], consumer);
    await run([join(consumer, 'node_modules/slicewright/dist/cli.js'), '--help'], consumer);
    await writeFile(join(consumer, 'package.json'), `${JSON.stringify({
      ...packageJson,
      dependencies: {
        ...packageJson.dependencies,
        'playwright-core': await installedVersion('playwright-core'),
        '@types/node': await installedVersion('@types/node'),
      },
    }, null, 2)}\n`);
    await run(install, consumer);
    await cp(join(root, 'examples/browser-e2e'), join(consumer, 'fixture'), { recursive: true });
    // Only the consumer's own test and example app are copied. All product
    // behavior resolves through the installed package's public exports.
    await cp(join(root, 'test/browser-e2e/consumer.mjs'), join(consumer, 'consumer.mjs'));
    await cp(
      join(root, 'test/browser-e2e/baseline-loader.mjs'),
      join(consumer, 'baseline-loader.mjs'),
    );
    await cp(join(root, 'test/browser-e2e/contract.ts.txt'), join(consumer, 'contract.ts'));
    await writeFile(join(consumer, 'tsconfig.json'), `${JSON.stringify({
      compilerOptions: {
        target: 'ES2023',
        lib: ['ES2023', 'DOM'],
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        noEmit: true,
        skipLibCheck: false,
        types: ['node'],
      },
      include: ['contract.ts'],
    }, null, 2)}\n`);
    const compiler = join(dirname(require.resolve('ttsc/package.json')), 'lib/launcher/ttsc.js');
    await run([compiler, '-p', join(consumer, 'tsconfig.json')], consumer);
    const stdout = await run([join(consumer, 'consumer.mjs'), output], consumer, 900_000);
    const report = typia.assert<BrowserConsumerReport>(JSON.parse(stdout));
    deepStrictEqual(
      report.engines.map((engine) => engine.browser),
      ['chromium', 'firefox', 'webkit'],
      'Every required browser engine must run without skips.',
    );
    for (const engine of report.engines) {
      ok(engine.version.trim().length > 0, `${engine.browser}: report the browser version.`);
      strictEqual(engine.passed, 8, `${engine.browser}: every normal DOM/Canvas case must pass.`);
      strictEqual(
        engine.negativeControls,
        10,
        `${engine.browser}: every injected failure must be detected.`,
      );
      strictEqual(engine.cases.length, 18, `${engine.browser}: run the full scenario matrix.`);
      strictEqual(engine.captureProbes, 2, `${engine.browser}: verify fixed and sticky captures.`);
      strictEqual(
        engine.baselineRoundTrips,
        2,
        `${engine.browser}: persist both renderers' baselines.`,
      );
      strictEqual(engine.output, join(output, engine.browser), 'Keep browser artifacts separate.');
      for (const result of engine.cases) {
        strictEqual(result.browser, engine.browser, `${result.name}: identify the browser.`);
        ok(
          Number.isInteger(result.initialCaptureAttempts) &&
          result.initialCaptureAttempts >= 2 && result.initialCaptureAttempts <= 5,
          `${engine.browser}: ${result.name}: require bounded initial snapshot settling.`,
        );
        strictEqual(result.rejected, result.fault !== 'none', `${engine.browser}: ${result.name}`);
      }
    }
    strictEqual(
      report.passed,
      24,
      'Every viewport/DPR/scroll case must pass on all three engines.',
    );
    strictEqual(
      report.negativeControls,
      30,
      'Every injected failure must be detected on both renderers and all three engines.',
    );
    strictEqual(report.cases.length, 54);
    deepStrictEqual(
      report.cases,
      report.engines.flatMap((engine) => engine.cases),
    );
    strictEqual(
      report.captureProbes,
      6,
      'Fixed and sticky captures must preserve fractional CSS geometry on all three engines.',
    );
    strictEqual(
      report.baselineRoundTrips,
      6,
      'Both renderers must restore baselines and detect rendered activation on all three engines.',
    );
    return report;
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
}
