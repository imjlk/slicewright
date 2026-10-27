import { join } from 'node:path';

import { defineConfig } from '@playwright/test';

const output = process.env.SLICEWRIGHT_CONSUMER_OUTPUT ?? 'test-results';
const channel = process.env.SLICEWRIGHT_CHROME_CHANNEL;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  fullyParallel: true,
  workers: 2,
  retries: 0,
  timeout: 15_000,
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
