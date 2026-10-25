import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { test } from 'node:test';

import { buildPromptPlan } from '../src/prompt.js';
import {
  correctPromptPlan,
  promptCorrections,
  readFindingsReport,
} from '../src/prompt-corrections.js';

/**
 * @evidence docs/spec.md#prompt-corrections Checks the report shape, build pieces, axis wording, deduplication, ignored info and export codes, and the appended prompt.
 * @evidenceReview docs/spec.md#prompt-corrections #0ff6b1c Checked the assertions against the section and ran this test green with pnpm test.
 */
export function correctsPrompts(): void {
  const report = readFindingsReport({
    ok: false,
    width: 10,
    findings: [
      { code: 'stretch.y.nonuniform', severity: 'error', message: 'Rows differ.' },
      { code: 'stretch.x.none', severity: 'warning', message: 'No match.' },
      { code: 'stretch.y.nonuniform', severity: 'error', message: 'Again.' },
      { code: 'tile.x.auto', severity: 'info', message: 'Tiles.' },
      { code: 'target.unsupported', severity: 'error', message: 'Not here.' },
      { code: 'alpha.interior', severity: 'info', message: 'Info only.' },
    ],
  });
  const lines = promptCorrections(report);
  strictEqual(lines.length, 2);
  ok(lines[0]?.includes('left and right edges'));
  ok(lines[1]?.includes('adjacent columns'));
  ok(lines[1]?.includes('top and bottom edges'));

  const plan = buildPromptPlan({
    kind: 'panel',
    style: 'stone',
    background: 'transparent',
    pixelArt: false,
  });
  const corrected = correctPromptPlan(plan, lines);
  deepStrictEqual(corrected.corrections, lines);
  ok(corrected.prompt.startsWith(plan.prompt));
  ok(corrected.prompt.includes('\nCorrections from the previous attempt:\n- '));
  strictEqual(correctPromptPlan(plan, []).prompt, plan.prompt);

  throws(() => readFindingsReport({ findings: [{ code: 'x' }] }));
  throws(() => readFindingsReport([]));

  const build = {
    ok: false,
    pieces: [
      { name: 'a', findings: [{ code: 'noise.high', severity: 'warning' }] },
      { name: 'b', findings: [] },
    ],
  };
  strictEqual(promptCorrections(readFindingsReport(build, 'a')).length, 1);
  strictEqual(promptCorrections(readFindingsReport(build, 'b')).length, 0);
  throws(() => readFindingsReport(build), /a, b/);
  throws(() => readFindingsReport(build, 'c'), /No piece named c/);
  throws(() => readFindingsReport(report, 'a'), /only from a build report/);
}

void test('prompt corrections', correctsPrompts);
