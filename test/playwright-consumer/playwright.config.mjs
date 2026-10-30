import { join } from 'node:path';

import { defineConfig } from '@playwright/test';

const output = process.env.SLICEWRIGHT_CONSUMER_OUTPUT ?? 'test-results';
const channel = process.env.SLICEWRIGHT_CHROME_CHANNEL;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  fullyParallel: true,
  // The dedicated concurrent-assertion case still runs two assertions together.
  // Serial workers keep native browser startup outside other tests' short deadlines.
  workers: 1,
  retries: 0,
  // Baseline assertions must remain read-only even under explicit runner update mode.
  updateSnapshots: 'all',
  snapshotPathTemplate: '{testDir}/approved/{projectName}/{testFilePath}/{arg}{ext}',
  // Cold Windows Firefox capture/setup exceeded the shortened 15 s budget in CI.
  // Keep Playwright's normal 30 s test budget; matcher deadlines and the explicit
  // 2 s remaining-test-budget probe remain independently bounded.
  timeout: 30_000,
  expect: { timeout: 1000 },
  reporter: [['json', { outputFile: process.env.SLICEWRIGHT_CONSUMER_REPORT }]],
  outputDir: output,
  use: {
    viewport: { width: 960, height: 900 },
    trace: 'off',
  },
  projects: ['chromium', 'firefox', 'webkit'].map((name) => ({
    name,
    outputDir: join(output, name),
    use: {
      browserName: name,
      ...(name === 'chromium' && channel ? { channel } : {}),
    },
  })),
});
