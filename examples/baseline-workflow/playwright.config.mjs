import { defineConfig } from '@playwright/test';
const port=Number(process.env.SLICEWRIGHT_EXAMPLE_PORT??4179);
const channel=process.env.SLICEWRIGHT_CHROME_CHANNEL;
export default defineConfig({
  testDir:'.',testMatch:'workflow.spec.mjs',workers:1,retries:0,timeout:60_000,
  expect:{timeout:8000},
  snapshotPathTemplate:'{testDir}/baselines/{platform}/{projectName}/{arg}{ext}',
  reporter:process.env.SLICEWRIGHT_EXAMPLE_REPORT?[['json',{outputFile:process.env.SLICEWRIGHT_EXAMPLE_REPORT}]]:'list',
  outputDir:process.env.SLICEWRIGHT_EXAMPLE_OUTPUT??'test-results',
  use:{baseURL:`http://127.0.0.1:${port}`,deviceScaleFactor:1},
  webServer:{command:'node serve.mjs',url:`http://127.0.0.1:${port}`,reuseExistingServer:false},
  projects:['chromium','firefox','webkit'].map(name=>({name,use:{browserName:name,...(name==='chromium'&&channel?{channel}:{})}})),
});
