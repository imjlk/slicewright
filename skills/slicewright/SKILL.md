---
name: slicewright
description: Make and check stretchable game UI art, and verify rendered HTML/CSS or Canvas UI with explicit targets and approved visual baselines. Use for nine-slice assets, slice insets, smeared or seamed UI, atlas frames, or browser UI regression checks with Slicewright and Playwright.
license: MIT
metadata:
  compatibility: Requires Node.js 22 or newer and npm (runs the slicewright CLI through npx).
---

# slicewright

slicewright plans generation prompts for stretchable UI art, removes chroma
backgrounds, resizes, detects or checks slice insets, renders stretched
previews, and writes Phaser `scale9Borders`. It does not generate images. Use
whatever image generator this agent has (an image generation skill or tool, or
art the user supplies) and run every result through slicewright before it
reaches the game.

For an existing browser UI, start with
[Browser regression checks](references/browser-testing.md). That workflow uses
the optional browser/Playwright APIs and does not require generating or slicing
art. Keep the asset workflow below for tasks that actually involve UI images.

## Run the CLI

slicewright needs Node.js 22 or newer. Node 22, 24 and later all work, so do
not suggest an upgrade unless `node --version` reports a major version below 22.
Every `slicewright <command>` in this skill and its references means
`npx -y slicewright <command>`. Leave the version off: npx then runs the
project's installed copy, at whatever version the project pins, and downloads
the latest release only when the project has none. From a clone of the
repository, run `pnpm install && pnpm build` once there, then use
`node <clone>/dist/cli.js <command>` instead. Every command prints JSON on
stdout; `inspect`, `compare`, `frame`, `atlas`, `normalize`, `export`,
`pack`, and `build` exit 1 when a finding is an error (for `export`, a layout
the target cannot represent), `browser-report` exits 1 for a failing report,
and every command exits 2 on bad input. `prompt`, `preview`, `key`, `resize`,
and `targets` never exit 1: read their JSON. Output folders are created as
needed. `--help` works on each command and ends with examples.

## Workflow

1. **Collect the brief.** UI kind (`button`, `panel`, `dialog`, `bar`,
   `bar-fill`, `tooltip`, `bubble`, `bubble-tail`, `frame`), art style in the user's words, the largest size the
   element is drawn at in the game, pixel art or not, and the background the
   generator can produce (`transparent`, `chroma-green`, `chroma-magenta`).
   If a resizable body needs a fixed crest, ribbon, or other attached art,
   plan the pieces and their runtime content before generating them; read
   [Layered UI](references/layering.md). A decorative image has no implied
   text area: text inside it needs an explicitly specified and checked region.
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
   When an attempt fails a check, save that command's JSON report and plan the
   next attempt from it: `slicewright prompt --kind panel --style "<style>"
   --from report.json` adds one correction line per warning or error that the
   artist can fix (listed as `corrections`). `--kind` and `--style` are still
   required. For a `build` report, pick the piece with `--piece <name>`; a
   compare report is read whole.
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
   so the factor is the generated pixel size, which keeps the grid even, or
   add `--pixel-art` to snap the grid first; when flat art reports
   `pixel.grid-undetermined`, give the known scale with `--pixel-scale N`.
5. **Read the findings** with the table in
   [references/findings.md](references/findings.md). Fix every `error`, and compare
   `minSize` with the smallest size the game uses (`insets.large` warns when
   the fixed parts take most of an axis). Pass
   `--insets l,r,t,b` to `inspect` to check insets chosen by hand, `--mode
   three` for horizontal-only art (repeat it on every later `inspect`,
   `preview`, and `export` of that image, or they detect a nine-slice again), `--mode three-vertical` for vertical-only
   art (scroll bar tracks), `--tile x` when an edge should repeat, and
   `--regions multi` when fixed detail sits in the middle of an edge (a crest
   on a title plate). A multi-region `normalize --keep` texture is too small
   to re-detect: save the normalize JSON (every normalize report carries its
   `layout`) and pass it to `inspect`, `preview`, `frame`, or `export` with
   `--layout report.json`; their reports then say `"insetsSource": "layout"`. Pass `--padding l,r,t,b` when the detected content
   padding (where text fits inside the frame) is wrong.
6. **Look at the preview.** `slicewright preview ui/panel.png --out
   sheet.png`, then open `sheet.png`. Cells, in order: flexible segments
   tinted magenta with the content box outlined in cyan, source, minimum size,
   wide (when the width resizes), tall (when the height resizes), doubled,
   and, when a finding marks a place, a diagnostics cell: the art dimmed, with
   the first mismatching columns or rows and tile seams in red and partly
   transparent interior pixels in yellow (listed as `diagnostics` in the JSON).
   Repeat `--mode three` and any other slice option from normalize here.
   Corners must look identical in every cell and edges must not smear.
   Cells wrap into rows at `--max-width` (2048 px). An image viewer shrinks a
   large sheet until seams vanish, so look closer with `--cells guides,wide`
   (any of `guides,source,min,wide,tall,double,diagnostics`; asking for
   `diagnostics` when no finding marks a place is an error) and add `--zoom 3` or more
   for small art such as bars and buttons; the printed `cells` give each
   cell's rectangle for cropping.
   Then test real titles, body text, and buttons at the smallest and largest
   intended sizes; an art-only preview and `minSize` do not prove content fits.
   For a layered component, keep its body size, attachment placement, total
   content insets, and responsive rules together in application code; follow
   [Layered UI](references/layering.md). The runnable CSS example has a
   reusable assembly configuration and Korean/English text checks at 200%:
   [content preview](https://github.com/imjlk/slicewright/tree/main/examples/content-preview).
7. **Hand it to the engine.** `slicewright export ui/panel.png --target
   phaser,css --out-dir ui` writes each engine's files for a PNG that is
   already final. It detects insets and padding again, so repeat any
   `--insets`, `--padding`, `--mode`, or `--tolerance` you used before. Printed URLs are
   relative to the directory you run from, as if the game were served from
   there; run it from the game's served root or pass `--image-ref`. Prefix
   `--name` (`ui-button`) so CSS class names do not collide in a page. It
   prints how to use them; `slicewright targets` lists what each target
   can represent. Phaser and CSS are verified in the real engine. `unity`
   (spriteBorder values, no files, never `.meta`), `defold` (`slice9` values),
   and `godot` (a `StyleBoxTexture` `.tres`; pass `--image-ref res://…`) are
   experimental: they follow the documented formats but are untested in the
   engine, so check them there before shipping.
8. **Pack a set.** `slicewright pack ui/dialog.json ui/button.json ui/bar.json
   --out ui/ui.png` puts every piece in one image and atlas, so the game loads
   them with one `this.load.atlas`; it prints a `nineslice` call per frame,
   with tiling flags. Add `--css` for one stylesheet with a class per piece.
   Once the settings per piece are settled, write them into a manifest
   (`{"out": "ui/ui.png", "pieces": [{"input": "art/dialog.png", "width": 320}]}`
   with the `normalize` options per piece, and `groups` for states; see
   [references/build.md](references/build.md)) and rerun the whole set with
   `slicewright build ui.build.json`; `--watch` rebuilds on every change.
   Packing keeps frames untrimmed and unrotated with their borders, padding,
   and tiling, extrudes each edge by 1 px and leaves 2 px between frames
   (`--extrude`, `--spacing`), and checks the result. With another packer,
   disable trimming and rotation for nine-slice sprites, add `scale9Borders`
   per frame (TexturePacker 7.1+ can export them), then run
   `slicewright atlas ui.json` to check every frame against the pixels.
   Art drawn in Aseprite with 9-slice slices: export with
   `aseprite -b --list-slices ui.aseprite --sheet ui.png --data ui.json
   --format json-array` (`--list-slices` must come before the sprite), then `slicewright atlas ui.json` checks each slice's center
   on every frame its keys cover (`--slice <name>` for one) and prints the
   insets, which `frame --insets` or `normalize --insets` take.

## Making a matching set

For several related components or states, read
[references/matching-sets.md](references/matching-sets.md). Keep a short shared
art brief (materials, palette, lighting, shape language, and outline weight at
in-game scale), plus each piece's role and intended draw sizes. Review one
base piece first, then use the accepted result as a reference in the agent's
image generator for separate assets. Reuse the shared style in every `prompt` call.

A dialog, button, and bar can share a look while keeping different sizes and
slices. Normalize each stretchable piece to its intended scale before
`compare --as set` (or `--kind set`); this checks outline weight, so also review their color
and material together.

States of one button swap in place: use the default `compare` instead and fix
errors. Investigate inset/padding warnings through the state-family checks in
the reference. A `build` group can apply `sharedInsets: true` once its inputs
share a normalized canvas; preserve source proportions when they already do.
Verify the final packed borders with `atlas` and cycle the states in place.
Shared insets do not unify content padding: keep runtime labels in one
authored content box for the family. Keep dissimilar components out of state
groups. Save the commands, reports, and visual review with the accepted assets
so the set can be rechecked and extended.

## References

Read these when the task reaches them:

- [references/findings.md](references/findings.md): every finding code, what
  it means, and how to fix it. Read it at step 5.
- [references/build.md](references/build.md): the `build` manifest, piece
  options, and state groups with `sharedInsets`. Read it at step 8.
- [references/phaser.md](references/phaser.md): loading the atlas, creating a
  NineSlice, placing text inside the content padding, and tiling flags in
  Phaser 4.
- [references/progress-bars.md](references/progress-bars.md): a track and fill
  pair, with `setProgress` for Phaser and CSS.
- [references/speech-bubbles.md](references/speech-bubbles.md): a bubble body
  and a separate tail, matched outlines, and placing the tail in Phaser and CSS.
