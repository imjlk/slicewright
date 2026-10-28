import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  fullyParallel: true,
  workers: 2,
  retries: 0,
  timeout: 15_000,
  expect: { timeout: 1000 },
  reporter: [['json', { outputFile: process.env.SLICEWRIGHT_CONSUMER_REPORT }]],
  outputDir: process.env.SLICEWRIGHT_CONSUMER_OUTPUT,
  use: {
    browserName: 'chromium',
    channel: process.env.SLICEWRIGHT_CHROME_CHANNEL ?? 'chrome',
    viewport: { width: 960, height: 900 },
    trace: 'off',
  },
});
