---
name: slicewright
description: Make and check stretchable game UI art (nine-slice and three-slice buttons, panels, dialogs, bars and progress fills, tooltips, speech bubbles, frames). Use when generating or importing UI images that a game engine will stretch, when choosing slice insets or Phaser scale9Borders, when a NineSlice looks smeared or seamed, or when checking an atlas's nine-slice frames.
license: MIT
compatibility: Requires Node.js 24 or newer and npm (runs the slicewright CLI through npx).
---

# slicewright

slicewright plans generation prompts for stretchable UI art, removes chroma
backgrounds, resizes, detects or checks slice insets, renders stretched
previews, and writes Phaser `scale9Borders`. It does not generate images. Use
whatever image generator this agent has (an image generation skill or tool, or
art the user supplies) and run every result through slicewright before it
reaches the game.

## Run the CLI

Every `slicewright <command>` in this skill and its references means
`npx -y slicewright <command>`. Leave the version off: npx then runs the
project's installed copy, at whatever version the project pins, and downloads
the latest release only when the project has none. From a clone of the
repository, run `pnpm install && pnpm build` once there, then use
`node <clone>/dist/cli.js <command>` instead. Every command prints JSON on
stdout; `inspect`, `frame`, `normalize`, `export`, and `atlas` exit 1 when a
finding is an error (for `export`, a layout the target cannot represent), and
every command exits 2 on bad input. `--help` works on each command.

## Workflow

1. **Collect the brief.** UI kind (`button`, `panel`, `dialog`, `bar`,
   `bar-fill`, `tooltip`, `bubble`, `bubble-tail`, `frame`), art style in the user's words, the largest size the
   element is drawn at in the game, pixel art or not, and the background the
   generator can produce (`transparent`, `chroma-green`, `chroma-magenta`).
2. **Plan the prompt.**
   `slicewright prompt --kind panel --style "<style>" --background transparent`
   Send `prompt` to the image generator as written. Pass the `avoid` list as a
   negative prompt where the generator takes one; otherwise append it to the
   prompt as an `Avoid: …` line. Use the plan's `aspect` as the generator's
   aspect ratio, or say it in the prompt when the generator has no such
   option. Generate one element per image. Ornament belongs in the corners;
   keep the edges between them plain, because a model-drawn rope, chain, vine,
   or wood grain along an edge neither stretches nor tiles cleanly. If the
   user's style invites texture (hand-painted wood, stone), keep the texture
   in the corners and fill, and ask for smooth edges.
3. **Key a chroma background** when the generator could not return alpha:
   `slicewright key art.png --out keyed.png` (the key is read from the border).
4. **Normalize.** `slicewright normalize art.png --width 480 --out ui/panel.png
   --name ui-panel --target phaser,css` crops margins, resizes to the in-game
   size with area averaging (`--filter nearest` for pixel art), picks insets
   and content padding at that size, and writes the engine files next to the
   PNG. This is the usual way to finish generated art; `export` (step 7) is
   for a finished PNG. The width you pick sets the scale of the corners and
   borders; the height follows the generated aspect, which only matters for
   how thick the top and bottom read, because the art stretches anyway. Give
   `--height` instead when the height is what must match. Add `--keep 8` to
   shrink the texture when the art is flat; it refuses axes where that would
   lose texture or shading, which is most painted art. Lines thinner than the
   downscale factor (generated width / `--width`) fade or vanish: a 1 px
   outline drawn at 1600 px is gone at 320 px (`resize.thin-lines`). Ask for line
   weights in proportion to the element ("an outline about 1/40 of the
   height") and check outlines in the preview. For pixel art, pick `--width`
   so the factor is the generated pixel size, which keeps the grid even.
5. **Read the findings** with the table in
   [references/findings.md](references/findings.md). Fix every `error`, and compare
   `minSize` with the smallest size the game uses (`insets.large` warns when
   the fixed parts take most of an axis). Pass
   `--insets l,r,t,b` to `inspect` to check insets chosen by hand, `--mode
   three` for horizontal-only art, `--mode three-vertical` for vertical-only
   art (scroll bar tracks), `--tile x` when an edge should repeat, and
   `--regions multi` when fixed detail sits in the middle of an edge (a crest
   on a title plate). Pass `--padding l,r,t,b` when the detected content
   padding (where text fits inside the frame) is wrong.
6. **Look at the preview.** `slicewright preview ui/panel.png --out
   sheet.png`, then open `sheet.png`. Cells, in order: flexible segments
   tinted magenta with the content box outlined in cyan, source, minimum size,
   wide (when the width resizes), tall (when the height resizes), doubled.
   Corners must look identical in every cell and edges must not smear.
   Cells wrap into rows at `--max-width` (2048 px). An image viewer shrinks a
   large sheet until seams vanish, so look closer with `--cells guides,wide`
   (any of `guides,source,min,wide,tall,double`) and add `--zoom 3` or more
   for small art such as bars and buttons; the printed `cells` give each
   cell's rectangle for cropping.
7. **Hand it to the engine.** `slicewright export ui/panel.png --target
   phaser,css --out-dir ui` writes each engine's files for a PNG that is
   already final. It detects insets and padding again, so repeat any
   `--insets`, `--padding`, `--mode`, or `--tolerance` you used before. Printed URLs are
   relative to the directory you run from, as if the game were served from
   there; run it from the game's served root or pass `--image-ref`. Prefix
   `--name` (`ui-button`) so CSS class names do not collide in a page. It
   prints how to use them; `slicewright targets` lists what each target
   can represent. Only Phaser and CSS are supported; both are verified in the
   real engine.
8. **Pack a set.** `slicewright pack ui/dialog.json ui/button.json ui/bar.json
   --out ui/ui.png` puts every piece in one image and atlas, so the game loads
   them with one `this.load.atlas`; it prints a `nineslice` call per frame,
   with tiling flags. Add `--css` for one stylesheet with a class per piece.
   Once the settings per piece are settled, write them into a manifest
   (`{"out": "ui/ui.png", "pieces": [{"input": "art/dialog.png", "width": 320}]}`
   with the `normalize` options per piece) and rerun the whole set with
   `slicewright build ui.build.json`; `--watch` rebuilds on every change.
   Packing keeps frames untrimmed and unrotated with their borders, padding,
   and tiling, extrudes each edge by 1 px and leaves 2 px between frames
   (`--extrude`, `--spacing`), and checks the result. With another packer,
   disable trimming and rotation for nine-slice sprites, add `scale9Borders`
   per frame (TexturePacker 7.1+ can export them), then run
   `slicewright atlas ui.json` to check every frame against the pixels.

## Making a matching set

Several pieces that belong together (a dialog, a button, and a bar) need one
style description used word for word in every `prompt` call, generated in one
session. When the generator accepts reference images, generate the main piece
first and pass it as a reference for the others. Normalize each piece to its
own in-game width, then put the preview sheets side by side and regenerate a
piece that drifts in color or wood tone before slicing further. Pack the
finished pieces into one atlas (step 8).

## References

Read these when the task reaches them:

- [references/findings.md](references/findings.md): every finding code, what
  it means, and how to fix it. Read it at step 5.
- [references/phaser.md](references/phaser.md): loading the atlas, creating a
  NineSlice, placing text inside the content padding, and tiling flags in
  Phaser 4.
- [references/progress-bars.md](references/progress-bars.md): a track and fill
  pair, with `setProgress` for Phaser and CSS.
- [references/speech-bubbles.md](references/speech-bubbles.md): a bubble body
  and a separate tail, matched outlines, and placing the tail in Phaser and CSS.
