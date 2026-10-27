import { verifiesPackedPlaywrightConsumer } from '../test/playwright-consumer.test.js';

try {
  const report = await verifiesPackedPlaywrightConsumer();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
}
