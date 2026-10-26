# Matching components and state families

Use this when the requested output is a set or state family; a single image
can follow the main workflow directly. Expand only the pieces the task needs.

## Plan a shared look

Keep a brief alongside the art, in the project's existing notes or task record:

- Shared art direction: materials, palette, light direction, shape language,
  and outline weight at the intended draw scale. For example: light oak,
  cream fill, warm brown outlines, soft light from above, rounded corners;
  about 2 px outlines at normal size. Keep stretchable edges plain.
- Each piece's role, slice mode, normal draw size, and smallest/largest uses.
  Record a state family only for variants that swap in the same element.
- The accepted base/reference image and the style string used for prompts.

A dialog, button, and progress track belong to one visual set. The button's
normal, hover, and pressed variants form a state family within it. Different
components need not have equal dimensions, insets, or padding.

## Establish a reference, then generate separate assets

Pick a representative base piece, usually the main panel or dialog. Generate,
normalize, and review it through the main workflow before expanding the set.
Reuse its material, palette, and outline decisions in every prompt. Generate
one element per image, using the accepted base as a reference when the agent's
image tool supports references. Keep each component's own shape and dimensions
while reusing the base's appearance. A shared prompt helps but does not guarantee
matching art; inspect each result. Slicewright produces prompt text only.

For example, with the CLI invocation from the main skill:

```sh
mkdir -p art ui reports
ui_style='Light oak and cream, warm brown outlines, soft top lighting, rounded corners; plain stretchable edges'
slicewright prompt --kind dialog --style "$ui_style" > reports/dialog-prompt.json
slicewright prompt --kind button --style "$ui_style" > reports/button-prompt.json
slicewright prompt --kind bar --style "$ui_style" > reports/bar-prompt.json
```

Send each plan's `prompt`, `avoid`, and `aspect` to the agent's generator as in
the main workflow; save its separate results as `art/dialog.png`,
`art/button.png`, and `art/bar.png`. For a state family, use the accepted normal
state as the geometry reference and describe the desired state change without
moving the frame or content area. Keep text and interactive content in the UI.

## Compare at the intended scale

Normalize before comparing; a large source image's outline is not its final
line weight. These widths are examples; use the brief's dimensions and check
that the resulting heights and `minSize` suit the intended draws:

```sh
slicewright normalize art/dialog.png --width 480 --out ui/dialog.png > reports/dialog-normalize.json
slicewright normalize art/button.png --width 192 --out ui/button.png > reports/button-normalize.json
slicewright normalize art/bar.png --width 240 --mode three --out ui/bar.png > reports/bar-normalize.json
slicewright compare --kind set ui/dialog.png ui/button.png ui/bar.png > reports/set-compare.json
```

Open the preview sheets from the main workflow together at their intended
scale, and check palette, material, lighting, and outline consistency. Set
comparison measures only outline weight; it does not score those other style
choices. Read every report even on exit 0: `compare.outline` is a warning and
`compare.outline-missing` means an outline could not be measured. Individual
inspection errors still fail the comparison. Compare stretchable components
with this command; review standalone decorative sprites visually alongside
them. Regenerate a mismatched piece using the accepted reference, then repeat
its normalization and comparisons.

## Validate states that swap in place

Normalize normal/hover/pressed inputs to a common canvas and check both
dimensions. Width-only normalization can leave different heights when source
aspects differ. When the resulting sizes already match, preserve those
proportions: a nine-slice can add height at runtime through its stretch region
while keeping the corners intact. The source height need not equal every draw
height; respect its `minSize` and check the rendered content. Then run:

```sh
slicewright compare ui/button-normal.png ui/button-hover.png ui/button-pressed.png > reports/button-states.json
```

States must have equal sizes, slice modes, and tiled axes, and pass inspection
with the returned `sharedInsets` (the largest inset on each side). The
`compare.insets` and `compare.padding` warnings describe each state's detected
geometry before common insets are applied. Differences greater than `--slack`
(1 px by default) need review: independently using those detections can make
corners or content jump.

If painted variation disrupts detection, inspect the source and stretched
previews at the intended scale before choosing a different matching tolerance.
Record the visual reason and repeat the chosen `--tolerance` on normalization,
comparison, preview, and atlas checks, and as `tolerance` on every build piece.
Do not raise tolerance or comparison slack merely to silence findings.

After that, a manifest can apply the shared insets and pack the family:

```json
{
  "out": "ui/buttons.png",
  "pieces": [
    {"input": "ui/button-normal.png", "name": "btn-normal", "crop": false},
    {"input": "ui/button-hover.png", "name": "btn-hover", "crop": false},
    {"input": "ui/button-pressed.png", "name": "btn-pressed", "crop": false}
  ],
  "groups": [{
    "name": "button", "sharedInsets": true,
    "pieces": ["btn-normal", "btn-hover", "btn-pressed"]
  }]
}
```

Save as `buttons.build.json` beside `ui/` and `reports/`, then run
`slicewright build buttons.build.json > reports/buttons-build.json`. Group
members are piece names. They cannot supply `insets`, `padding`, or
`regions: "multi"`; with `sharedInsets: true`, they also cannot supply `width`,
`height`, or `scale`. The example's `crop: false` preserves the already
normalized canvas. Other components may be in the same manifest without being
in this group. See [build.md](build.md) for the full schema and failure cases.

Check the group's `applied` result and the final atlas: every state must have
the same frame size and slice borders. Validate those borders against the
packed pixels with `slicewright atlas ui/buttons.json > reports/buttons-atlas.json`
(repeat `--tolerance` if chosen above). The group's original `compare.insets`
warning can remain after shared insets align the exports; verify the resulting
metadata and atlas check before accepting that geometry.

`sharedInsets` does not unify content padding. Give runtime labels one authored
content box that fits every state, instead of moving them with each state's
detected padding. Cycle the states in place at the smallest and largest intended
draw sizes: inspect corner alignment, text fit, seams, and readable state cues.
Retain any remaining warnings and their visual review in the final report;
matching packed metadata alone does not prove the composed UI works.
For Phaser frame swaps, use the [NineSlice state recipe](phaser.md), including
its texture-coordinate refresh; a changed frame name alone is insufficient.

Retain the brief, reference, exact commands/options, prompt plans, and latest
reports with a short visual review of the accepted set. A failed build report
can inform the next prompt: `slicewright prompt --kind button --style
"$ui_style" --from reports/buttons-build.json --piece btn-hover`. This adds
corrections for supported findings; describe visual style drift yourself.
