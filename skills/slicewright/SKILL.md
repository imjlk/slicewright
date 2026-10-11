---
name: slicewright
description: Make and check stretchable game UI art (nine-slice and three-slice buttons, panels, dialogs, bars, tooltips, frames). Use when generating or importing UI images that a game engine will stretch, when choosing slice insets or Phaser scale9Borders, when a NineSlice looks smeared or seamed, or when checking an atlas's nine-slice frames.
---

# slicewright

slicewright plans generation prompts for stretchable UI art, removes chroma
backgrounds, resizes, detects or checks slice insets, renders stretched
previews, and writes Phaser `scale9Borders`. It does not generate images. Use
whatever image generator this agent has (an image generation skill or tool, or
art the user supplies) and run every result through slicewright before it
reaches the game.

## Run the CLI

Use `npx slicewright` when the package is installed. From a clone, run
`pnpm install && pnpm build` once in `$SLICEWRIGHT_ROOT`, then
`node $SLICEWRIGHT_ROOT/dist/cli.js`. Every command prints JSON on stdout;
`inspect`, `frame`, `normalize`, and `atlas` exit 1 when a finding is an
error, and every command exits 2 on bad input. `--help` works on each command.

## Workflow

1. **Collect the brief.** UI kind (`button`, `panel`, `dialog`, `bar`,
   `tooltip`, `frame`), art style in the user's words, the largest size the
   element is drawn at in the game, pixel art or not, and the background the
   generator can produce (`transparent`, `chroma-green`, `chroma-magenta`).
2. **Plan the prompt.**
   `slicewright prompt --kind panel --style "<style>" --background transparent`
   Send `prompt` to the image generator as written and pass the `avoid` list
   as a negative prompt where the generator takes one. Generate one element
   per image. Ornament belongs in the corners; keep the edges between them
   plain, because a model-drawn rope, chain, or vine edge neither stretches
   nor tiles cleanly.
3. **Key a chroma background** when the generator could not return alpha:
   `slicewright key art.png --out keyed.png` (the key is read from the border).
4. **Normalize.** `slicewright normalize art.png --width 480 --out ui/panel.png
   --atlas ui/panel.json --name panel` crops margins, resizes to the in-game
   size with area averaging (`--filter nearest` for pixel art), picks insets
   at that size, and writes a one-frame atlas. Add `--target` to write engine
   files at the same time (see step 7). Add `--keep 8` to shrink the
   texture when the art is flat; it refuses axes where that would lose
   texture or shading.
5. **Read the findings** with the table below. Fix every `error`. Pass
   `--insets l,r,t,b` to `inspect` to check insets chosen by hand, `--mode
   three` for horizontal-only art, `--tile x` when an edge should repeat.
6. **Look at the preview.** `slicewright preview ui/panel.png --out
   sheet.png`, then open `sheet.png`. Cells, left to right: stretch spans
   tinted magenta, source, minimum size, wide, tall (nine-slice only),
   doubled. Corners must look identical in every cell and edges must not
   smear.
7. **Hand it to the engine.** `slicewright export ui/panel.png --target
   phaser,css --out-dir ui` writes each engine's files
   and prints how to use them; `slicewright targets` lists what each target
   can represent. Only Phaser and CSS are supported; both are verified in the
   real engine. For a packed atlas, disable trimming (and rotation) for
   nine-slice sprites, add `scale9Borders` per frame (TexturePacker 7.1+ can
   export them), then run `slicewright atlas ui.json` to check every frame
   against the pixels.

## Findings

| Code | Meaning | Fix |
| --- | --- | --- |
| `stretch.x.nonuniform`, `stretch.y.nonuniform` | Given insets cut into detail, so stretching changes the art. | Widen the insets past the named pair, or let detection pick them. |
| `stretch.x.none`, `stretch.y.none` | No two adjacent lines match; any stretch smears. | Regenerate with plain edges and center, or use `--mode three` for a vertical gradient. |
| `stretch.x.short`, `stretch.y.short` | Only a tiny run matches and nothing repeats: the edges carry non-repeating detail (vines, drawn rope). | Regenerate with plain edges between the corners; or choose insets by hand after the preview. |
| `tile.x.auto`, `tile.y.auto` | The edges repeat with the named period, so that axis tiles. | Create the NineSlice with `tileX` / `tileY`; atlas data cannot carry it. |
| `tile.x.seam`, `tile.y.seam` | A tiled span cuts its pattern or jumps where it wraps. | Use one of the `nearestLengths`, or make the texture seamless. |
| `three-slice.auto` | Rows never repeat, so the layout keeps a fixed height. | Fine for bars. For panels, regenerate with a flat center. |
| `three-slice.vertical.auto` | Columns never repeat but rows do, so the layout keeps its width. | Fine for vertical tracks. For panels, regenerate with plain edges. |
| `regions.multi` | The layout has several stretch regions per axis. | Preview only: no current target exports it; re-slice as a nine-slice to export. |
| `target.unsupported` | The target cannot represent this layout; no files were written. | Pick a target that can, or re-slice as a nine-slice. |
| `target.emulated` | The target has no native form of this layout; the fixed axis has zero insets. | Keep that axis at its source size in the engine. |
| `target.experimental` | The target's output is not yet rendered in its engine. | Check it in the engine before shipping. |
| `target.tile` | The target cannot tile as asked, or counts tiles differently (CSS `round` takes the nearest count; Phaser rounds down). | Check the tiled edge at the sizes you use. |
| `target.fixed` | Nothing in the layout resizes; no files were written. | Use the image as a plain sprite. |
| `noise.tolerance` | Generated art is noisy, so matching tolerance was raised per axis. | Informational. `--noise off` restores exact matching. |
| `noise.high` | The interior is busy along both axes. | Stretching smears it; use a flatter fill or tile it. |
| `alpha.interior` | The middle of the element is partly transparent. | Usually a generator faking alpha: regenerate on a chroma key and run `key`. |
| `alpha.chroma-spill` | The alpha edge is tinted by the key color. | Re-run `key` with a lower `--keep`, or despill elsewhere. |
| `margin.transparent` | Transparent border pixels become part of the corners. | `normalize` crops them; otherwise crop unless the spacing is intended. |
| `rebuild.x.lossy`, `rebuild.y.lossy` | `--keep` would flatten texture or shading on that axis. | Informational: that axis kept its full span. |
| `rebuild.filtering` | A small `--keep` fades under linear texture filtering. | Use `--keep 8` or more, or nearest filtering (Phaser `pixelArt`). |
| `insets.asymmetric` | Opposite insets differ by more than 2 px. | Usually generator drift; check the preview. |
| `insets.invalid` | Insets leave no stretch pixel. | Shrink the insets. |
| `image.empty` | Every pixel is transparent. | The background removal took everything; redo it. |
| `atlas.trimmed` | Phaser NineSlice does not support trimmed frames. | Disable trimming for this sprite and repack. |
| `atlas.rotated` | Rotated frames are not a tested NineSlice input. | Disable rotation for this sprite. |
| `atlas.borders-outside-frame` | `scale9Borders` does not fit the frame. | Re-export the borders. |

## Phaser 4

```ts
this.load.atlas('ui', 'ui/panel.png', 'ui/panel.json');
// Insets come from the frame's scale9Borders; width and height default to the frame.
const panel = this.add.nineslice(400, 300, 'ui', 'panel', 320, 200);
panel.setSize(360, 220); // never below left+right by top+bottom; scale instead.
```

`scale9Borders` is the stretchable center rectangle `{ x, y, w, h }`. A frame
whose `y` is 0 and `h` equals the frame height is a three-slice and its height
cannot change. For a `tile.<axis>.auto` finding, pass `tileX` / `tileY` as the
last NineSlice constructor arguments; `export --target phaser` prints the call. Extrude or pad atlas frames by 1 to 2 px
so linear filtering does not bleed neighbors into the seams.
