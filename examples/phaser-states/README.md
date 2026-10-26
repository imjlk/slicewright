# Phaser state-transition pixel regression

`pnpm engine:check` (or `--engine phaser`) runs this dedicated 1280 × 224 canvas
alongside the existing real-art checks, using the same pinned Phaser 4.2.0 CDN
build. It does not enlarge the atlas comparison sheet toward WebGL canvas limits.
Serve the repository root over HTTP and open `examples/phaser-states/index.html`
to inspect the page; `tools/phaser-state-check.ts` drives its development-only API.

The same NineSlice and runtime label survive both requested sizes, 188 × 62 and
576 × 100, and the sequence normal → hover → pressed → hover → normal → disabled
→ normal. Each transition uses `setFrame(frame, true, false)` and waits for Phaser
`postrender`. The checker compares the entire captured button rectangle with a
fresh NineSlice constructed from the expected atlas frame at the same size,
background, and label. It allows mean channel error ≤ 0.1 and maximum ≤ 2 for
rounding. It also checks WebGL, frame names, button/label bounds, object survival,
and fixed slice insets. A logical state name or a changed image hash is not enough.

For each size, negative controls start from normal and call
`setFrame(frame, false, false)` for hover, pressed, and disabled. These controls
still have the right logical frame and geometry but leave stale UVs. Every
control must fail the same pixel assertion, with no other assertion failures,
or the overall check exits unsuccessfully. No later `setSize` repairs the stale
UVs before capture. Resizing happens only between the two size runs.

To save actual/reference comparisons and all six negative controls:

```sh
mkdir -p .slicewright/state-regression
pnpm engine:check --engine phaser --screenshot .slicewright/state-regression/check.png
```

The JSON report contains `phaserStates.cases`, `negativeControls`, and `failing`.
Images are named `check.states-{small,large}-{step}-{state}.png` and
`check.states-{small,large}-stale-{state}.png`; the left button is the reused
instance and the right button is the fresh expected-frame reference.

## Fixture provenance

`assets/buttons.png` and `buttons.json` are unchanged copies of the compact
four-state atlas from the 2026-10-27 Willow & Wish clean consumer exercise,
originally `slicewright-quest-e2e/ui/buttons.{png,json}`. That exercise reproduced
the logical-frame-only bug before adding rendered pixel checks. No image
generation occurs inside slicewright or in this regression check.

The normal button was generated with the agent's built-in image tool using the
bright RPG guild panel as a style reference. Hover, pressed, and disabled were
three separate edits of that normal image. The exact original prompts are in
`assets/prompts.md`. Generated alpha boundaries differed slightly; this fixture
does not claim that the four silhouettes are pixel-identical. The consumer used
published slicewright 0.3.1 to normalize each source to 224 × 49 at tolerance 8,
then packed the set with `crop: false` and `sharedInsets: true`.

All four frames use `scale9Borders {x:20,y:20,w:183,h:10}`, which gives fixed
left/right/top/bottom borders of **20/21/20/19** and a minimum art size of 41 × 39.
The 226 × 210 atlas is 66,605 bytes. Runtime labels are separate and constant;
the painted centers contain no text.

SHA-256 of the copied PNG:
`a4058d02868798a12f17f75b3fd4fc855af8fac8d28f29602318c104ebdf76e4`.
SHA-256 of the copied atlas JSON:
`67fe23fde3adb353262ccecbfbc632c09dbdc2cf7506e6d094d85d011346d2e2`.

This is regression tooling and example data only. It changes no published
package behavior, API, CLI, or skill, so it needs no Sampo changeset.
