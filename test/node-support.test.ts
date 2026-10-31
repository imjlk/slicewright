import { match, ok, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/**
 * The oldest supported Node line is stated in package.json engines; the skill
 * and the docs must name that same line so none of them asks users on a
 * supported Node to upgrade.
 */
export function namesOneMinimumNode(): void {
  const engines = (JSON.parse(read('package.json')) as { engines: { node: string } }).engines.node;
  const minimum = /^>=(\d+)\.0\.0$/u.exec(engines)?.[1];
  ok(minimum, `engines.node should be >=N.0.0, got ${engines}`);
  strictEqual(minimum, '22');
  const skill = read('skills/slicewright/SKILL.md');
  match(skill, new RegExp(`Requires Node\\.js ${minimum} or newer`, 'u'));
  match(skill, new RegExp(`below ${minimum}\\.`, 'u'));
  for (const doc of [
    'README.md',
    'docs/browser.md',
    'docs/playwright.md',
    'skills/slicewright/references/browser-testing.md',
    'examples/baseline-workflow/README.md',
  ]) {
    for (const [, major] of read(doc).matchAll(/Node(?:\.js)? (\d+)(?:\+| or newer)/gu)) {
      strictEqual(major, minimum, `${doc} names Node ${major}`);
    }
  }
}

void test('one minimum Node version', namesOneMinimumNode);
