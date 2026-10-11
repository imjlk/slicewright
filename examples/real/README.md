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
| `crest` | transparent PNG, hand-written prompt | `normalize --width 480 --regions multi` |
| `bar-vertical` | the keyed bar turned a quarter turn | `normalize --height 320` |

`crest` has a crest in the middle of its top edge, so its prompt is written by
hand: `slicewright prompt` keeps decoration in the corners. No target exports a
multi-region layout yet, so it has no atlas or CSS. The manifest's
`inspections` list makes the engine check detect it with `--regions multi`
and compare the layout and finding codes with `crest.layout.json`. Single-region
detection on the same image stretches only the span right of the crest and
warns `insets.large`.

Every sample except `crest` was normalized with `--target phaser,css`, which writes its
`.json` atlas and `.css` class. `*-min` files add `--keep 4`. For painted art, most axes report
`rebuild.<axis>.lossy` and keep their full span; the pixel panel keeps 4 rows.

The button, dialog, pixel, bar, and scifi prompts predate the rule that edges
carry no pattern along them. A first baroque frame drawn with that older prompt
got a rope edge that could neither stretch nor tile; `baroque` is the redraw
with the current prompt.

`../tiled/rope.png` is a synthetic panel whose rope edge repeats exactly every
6 px, so the check also covers a tiled export (`tile.x.auto`).

Render them with `pnpm engine:check`, or serve the repository and open
`examples/phaser/index.html` or `examples/css/index.html`.
