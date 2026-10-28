import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { checkSnapshot, writeBrowserArtifacts } from 'slicewright/browser';

// Select the static initial reference only after two consecutive observations
// agree in every metadata field and RGBA byte. This setup runs before input or
// baseline approval; capture failures and later mismatches are never retried.
export async function settleInitialPanel(page, target, first, directory) {
  let previous = first;
  let actual = first;
  for (let attempts = 2; attempts <= 5; attempts++) {
    previous = actual;
    await page.evaluate(() => new Promise((done) => {
      requestAnimationFrame(() => requestAnimationFrame(done));
    }));
    actual = await target.capture();
    if (isDeepStrictEqual(actual, previous)) {
      return { snapshot: actual, attempts };
    }
  }
  const artifacts = join(directory, 'initial-unstable');
  await writeBrowserArtifacts(artifacts, {
    actual,
    reference: previous,
    report: checkSnapshot(actual, {
      reference: previous,
      stableGeometry: { reference: previous.measurement, tolerance: 0 },
    }),
  });
  throw new Error(
    `Initial panel did not produce two consecutive identical snapshots within 5 captures. Artifacts: ${artifacts}`,
  );
}
