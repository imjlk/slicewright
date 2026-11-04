import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { test } from 'node:test';

import { buildPromptPlan } from '../src/prompt.js';
import {
  correctPromptPlan,
  promptCorrections,
  readFindingsReport,
} from '../src/prompt-corrections.js';

/**
 * @evidence docs/spec.md#prompt-corrections Checks the report shape, build pieces, axis wording, deduplication, the regions.multi correction, ignored info and export codes, and the appended prompt.
 * @evidenceReview docs/spec.md#prompt-corrections #d3bff44 Reread the no-flag sentence. The test expects one body from counts and checks that line does not contain --mode.
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
      { code: 'regions.multi', severity: 'info', message: 'Two stretches.' },
      { code: 'alpha.interior', severity: 'info', message: 'Info only.' },
    ],
  });
  const lines = promptCorrections(report);
  strictEqual(lines.length, 3);
  ok(lines[2]?.includes('nine-slice, three-slice, or vertical three-slice'));
  const named = (x: number, y: number) =>
    promptCorrections(
      readFindingsReport({
        findings: [{ code: 'regions.multi', severity: 'info', details: { x, y } }],
      }),
    );
  strictEqual(named(2, 0)[0]?.includes('plain three-slice body'), true);
  strictEqual(named(0, 2)[0]?.includes('plain vertical three-slice body'), true);
  strictEqual(named(2, 1)[0]?.includes('plain nine-slice body'), true);
  strictEqual(named(2, 0).length, 1);
  ok(!named(2, 0)[0]?.includes('or vertical'));
  ok(!named(2, 0)[0]?.includes('--mode'));
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
  throws(() => readFindingsReport(report, 'a'), /No piece named a/);

  const compare = {
    ok: false,
    findings: [{ code: 'compare.size', severity: 'error' }],
    pieces: [
      { name: 'a', findings: [{ code: 'noise.high', severity: 'warning' }] },
      { name: 'b', findings: [] },
    ],
  };
  strictEqual(promptCorrections(readFindingsReport(compare)).length, 1);
  strictEqual(promptCorrections(readFindingsReport(compare, 'a')).length, 2);
  throws(() => readFindingsReport({ ...compare, findings: [{ code: 'x' }] }, 'a'));
  deepStrictEqual(
    promptCorrections({ findings: [{ code: 'constructor', severity: 'warning' }] }),
    [],
  );
}

void test('prompt corrections', correctsPrompts);
