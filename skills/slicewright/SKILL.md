---
name: slicewright
description: Make and check stretchable game UI art (nine-slice and three-slice buttons, panels, dialogs, bars, tooltips, frames). Use when generating or importing UI images that a game engine will stretch, when choosing slice insets or Phaser scale9Borders, when a NineSlice looks smeared or seamed, or when checking an atlas's nine-slice frames.
---

# slicewright

slicewright plans generation prompts for stretchable UI art, detects or checks
slice insets, renders stretched previews, and writes Phaser `scale9Borders`.
It does not generate images. Use whatever image generator this agent has (an
image generation skill or tool, or art the user supplies) and run every result
through slicewright before it reaches the game.

## Run the CLI

Use `npx slicewright` when the package is installed. From a clone, run
`pnpm install && pnpm build` once in `$SLICEWRIGHT_ROOT`, then
`node $SLICEWRIGHT_ROOT/dist/cli.js`. Every command prints JSON; `inspect`,
`frame`, and `atlas` exit 1 when any finding is an error.

## Workflow

1. **Collect the brief.** UI kind (`button`, `panel`, `dialog`, `bar`,
   `tooltip`, `frame`), art style in the user's words, the largest size the
   element is drawn at in the game, pixel art or not, and the background the
   generator can produce (`transparent`, `chroma-green`, `chroma-magenta`).
2. **Plan the prompt.**
   `slicewright prompt --kind panel --style "<style>" --background transparent`
   Send `prompt` to the image generator as written and pass the `avoid` list
   as a negative prompt where the generator takes one. Generate one element
   per image, square or at the plan's `aspect`.
3. **Prepare the image.** Remove a chroma background and despill its edge.
   Crop transparent margins. Downscale to the in-game size; insets are picked
   at the final size, never at the generation size. slicewright does not do
   these steps yet, so use the generator's tools or an image editor.
4. **Inspect.** `slicewright inspect art.png`. Fix every `error` and read
   every `warning` with the table below. Pass `--insets l,r,t,b` to check
   insets you chose by hand; `--mode three` for horizontal-only art;
   `--tile x` when the edge pattern should repeat instead of stretch.
5. **Look at the preview.** `slicewright preview art.png --out sheet.png`,
   then open `sheet.png`. Cells, left to right: stretch spans tinted magenta,
   source, minimum size, wide, tall (nine-slice only), doubled. Corners must
   look identical in every cell and edges must not smear.
6. **Hand it to the engine.**
   - Single image: `slicewright frame art.png --name panel --out panel.json`
     writes a one-frame JSON Hash atlas.
   - Packed atlas: disable trimming (and rotation) for nine-slice sprites,
     add `scale9Borders` per frame (TexturePacker 7.1+ can export them), then
     run `slicewright atlas ui.json` to check every frame against the pixels.

## Findings

| Code | Meaning | Fix |
| --- | --- | --- |
| `stretch.x.nonuniform`, `stretch.y.nonuniform` | Given insets cut into detail, so stretching changes the art. | Widen the insets past the named pair, or let `inspect` detect them. |
| `stretch.x.none`, `stretch.y.none` | No two adjacent lines match; any stretch smears. | Regenerate with flat edges and center, use `--mode three` for a vertical gradient, or tile with `--tile`. |
| `three-slice.auto` | Rows never repeat, so the layout keeps a fixed height. | Fine for bars. For panels, regenerate with a flat center. |
| `margin.transparent` | Transparent border pixels become part of the corners. | Crop them unless the spacing is intended. |
| `alpha.chroma-spill` | The alpha edge is tinted by the key color. | Despill or re-key, then inspect again. |
| `tile.x.seam`, `tile.y.seam` | The tiled span cuts its pattern or jumps where it wraps. | Use one of the `nearestLengths`, or make the texture seamless. |
| `insets.asymmetric` | Opposite insets differ by more than 2 px. | Usually generator drift; equal insets look tidier. |
| `insets.invalid` | Insets leave no stretch pixel. | Shrink the insets. |
| `image.empty` | Every pixel is transparent. | The background removal took everything; redo it. |
| `atlas.trimmed` | Phaser NineSlice does not support trimmed frames. | Disable trimming for this sprite and repack. |
| `atlas.rotated` | Rotated frames are not a tested NineSlice input. | Disable rotation for this sprite. |
| `atlas.borders-outside-frame` | `scale9Borders` does not fit the frame. | Re-export the borders. |

Detection is exact by default (`--tolerance 4`). Generated art with faint
noise may need `--tolerance 8` to `16`, or `--outlier-ratio 0.01`; prefer
cleaning the art over raising tolerance, because Phaser stretches whatever
line it gets.

## Phaser 4

```ts
this.load.atlas('ui', 'ui.png', 'ui.json');
// Insets come from the frame's scale9Borders; width and height default to the frame.
const panel = this.add.nineslice(400, 300, 'ui', 'panel', 320, 200);
panel.setSize(360, 220); // never below left+right by top+bottom; scale instead.
```

`scale9Borders` is the stretchable center rectangle `{ x, y, w, h }`. A frame
whose `y` is 0 and `h` equals the frame height is a three-slice and its height
cannot change. Extrude or pad atlas frames by 1 to 2 px so linear filtering
does not bleed neighbors into the seams.
