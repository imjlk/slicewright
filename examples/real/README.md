# Generated UI samples

Real model output, used to test slicewright beyond synthetic fixtures. Each
image was generated with the GPT `image_gen` route of
[sprite-gen](https://github.com/aldegad/sprite-gen) (`--provider codex`) from a
`slicewright prompt` plan saved under `prompts/`, then normalized:

| Sample | Source | Command |
| --- | --- | --- |
| `button` | transparent PNG | `normalize --width 240` |
| `dialog` | transparent PNG | `normalize --width 480` |
| `pixel` | transparent PNG | `normalize --width 240` |
| `bar` | chroma-green PNG | `key`, then `normalize --width 320` |
| `baroque` | transparent PNG | `normalize --width 480` |
| `scifi` | transparent PNG | `normalize --width 480` |
| `bar-fill` | chroma-magenta PNG, `bar.png` as a reference | `key`, then `normalize --height 28 --mode three` |
| `bubble`, `bubble-tail` | chroma-green PNGs; the tail generated with the body as a reference | body: `key`, `normalize --width 320`; tail: `key`, `resize --crop --match-outline bubble.png` |
| `crest` | transparent PNG, hand-written prompt | `normalize --width 480 --regions multi` |
| `bar-vertical` | the keyed bar turned a quarter turn | `normalize --height 320` |

`bar-fill` is the fill for `bar`: 28 px is the track's 33 px height minus its
top and bottom content padding (2 and 3 px).

`bubble-tail` is a separate sprite: no target can keep a tail fixed in the middle
of a stretching edge, so it is drawn on top of the body. The manifest's
`packs` list packs it with the body (`../packed/bubble.*`).

`crest` has a crest in the middle of its top edge, so its prompt is written by
hand: `slicewright prompt` keeps decoration in the corners. No target exports a
multi-region layout yet, so it has no atlas or CSS. The manifest's
`inspections` list makes the engine check detect it with `--regions multi`
and compare the layout and finding codes with `crest.layout.json`. When a
detection change is intended, a failing check prints the new result as
`detected`; save that object as `crest.layout.json`. Single-region
detection on the same image stretches only the span right of the crest and
warns `insets.large`.

Every sample except `crest` and `bubble-tail` was normalized with `--target phaser,css`, which writes its
`.json` atlas and `.css` class. `*-min` files add `--keep 4`. For painted art, most axes report
`rebuild.<axis>.lossy` and keep their full span; the pixel panel keeps 4 rows.

The button, dialog, pixel, bar, and scifi prompts predate the rule that edges
carry no pattern along them. A first baroque frame drawn with that older prompt
got a rope edge that could neither stretch nor tile; `baroque` is the redraw
with the current prompt.

`../packed/ui.*` is `pack dialog.json button.json bar.json ../tiled/rope.json
--css`; the manifest's `packs` list lets the engine check rebuild it and the
`packed …` entries render its frames next to the unpacked originals.

`../tiled/rope.png` is a synthetic panel whose rope edge repeats exactly every
6 px, so the check also covers a tiled export (`tile.x.auto`).

Render the exported samples with `pnpm engine:check`, or serve the repository and open
`examples/phaser/index.html` or `examples/css/index.html`.
