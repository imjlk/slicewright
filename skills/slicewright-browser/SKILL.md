---
name: slicewright-browser
description: Check a rendered HTML/CSS or Canvas game UI against approved visual baselines with slicewright's browser APIs. Use when a project imports or adds slicewright/browser or slicewright/playwright, or asks for domTarget or regionTarget bindings, toMatchUI, toBeStableUI, toMatchUIBaseline, saveBrowserBaseline, approved slicewright baselines, or a slicewright browser-report. Not for general Playwright testing without slicewright, and not for making or slicing UI art (use the slicewright skill).
license: MIT
compatibility: Requires Node.js 22 or newer, npm, and a project with @playwright/test and playwright-core plus the browser engines it tests (npx playwright install).
---

# slicewright-browser

slicewright's optional browser entry points check UI that the application has
already rendered: `slicewright/browser` binds a DOM or Canvas target and checks
its pixels, content fit, and text, and `slicewright/playwright` adds
`toMatchUI`, `toBeStableUI`, and `toMatchUIBaseline` to Playwright Test's
`expect`. They do not generate, slice, or export art. For nine-slice or
three-slice images, slice insets, previews, or engine export, use the
`slicewright` skill instead
(`npx skills add imjlk/slicewright --skill slicewright`).

## Set up

slicewright needs Node.js 22 or newer. Node 22, 24 and later all work, so do
not suggest an upgrade unless `node --version` reports a major version below 22.
Install into the project that owns the tests, then the browsers it covers:

```sh
npm install --save-dev slicewright @playwright/test playwright-core
npx playwright install chromium
```

Playwright is an optional peer dependency: importing `slicewright` or running
its CLI never loads it. These imports run in the Node test process, never in
the application's browser bundle. Assertions from `slicewright/playwright`
need an active Playwright Test; other runners and scripts use
`slicewright/browser` directly.

## Workflow

1. **Bind the target.** `domTarget(page, { root, contentBox, content })` for
   HTML/CSS; `regionTarget(page, { measure, prepare })` with layout and text
   metrics the application supplies for Canvas. Bind real content regions; an
   ornament or image never implies a safe text area.
2. **Drive real input once**, outside assertions, then wait for the
   application's readiness signal.
3. **Assert.** `toBeStableUI` for sampled visual stability, then `toMatchUI`
   or `toMatchUIBaseline` with content and text expectations as well as pixels.
4. **Approve deliberately.** Comparisons read existing approved baselines.
   Save new or replaced ones only when the task is to accept a reviewed design,
   with `saveBrowserBaseline(path, snapshot, { approved: true, environment })`.
5. **Diagnose failures** from the attached evidence, or turn an artifact
   directory into one offline HTML page with
   `npx -y slicewright browser-report <dir> --out report.html` (exit 0 pass,
   1 findings, 2 bad input).

Read [references/browser-testing.md](references/browser-testing.md) before
writing or changing a test: it has a complete example, environment keys,
tolerance and approval rules, and the coverage to exercise.
