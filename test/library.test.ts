import { deepStrictEqual, ok } from 'node:assert/strict';
import { test } from 'node:test';

import { packageRootExports } from '../src/library.js';
import * as root from '../src/index.js';

/**
 * @evidence docs/spec.md#package-root Checks the package root exports exactly the art pipeline and omits the CLI argument helpers.
 * @evidenceReview docs/spec.md#package-root #ad41b31 Reread the package-root section. The test checks the module namespace equals that list and that the CLI helpers are absent.
 */
export function exportsTheArtPipeline(): void {
  deepStrictEqual(Object.keys(root).sort(), [...packageRootExports()].sort());
  for (const name of ['joinNegativeNumbers', 'aliasedValue', 'AliasClashError']) {
    ok(!Object.hasOwn(root, name));
  }
  ok(typeof root.inspectRaster === 'function');
  ok(typeof root.exportForTarget === 'function');
}

void test('package root exports the art pipeline', exportsTheArtPipeline);
