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

`*-min` files add `--keep 4`. For painted art, most axes report
`rebuild.<axis>.lossy` and keep their full span; the pixel panel keeps 4 rows.

The button, dialog, pixel, bar, and scifi prompts predate the rule that edges
carry no pattern along them. A first baroque frame drawn with that older prompt
got a rope edge that could neither stretch nor tile; `baroque` is the redraw
with the current prompt.

Render them in Phaser 4 with `pnpm phaser:check`, or serve the repository and
open `examples/phaser/index.html`.
