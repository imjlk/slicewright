import { verifiesPackedBrowserConsumer } from '../test/browser-e2e.test.js';

try {
  const report = await verifiesPackedBrowserConsumer();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
}
