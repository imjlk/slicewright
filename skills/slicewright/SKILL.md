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
`inspect`, `frame`, `normalize`, `export`, and `atlas` exit 1 when a finding is
an error (for `export`, a layout the target cannot represent), and every
command exits 2 on bad input. `--help` works on each command.

## Workflow

1. **Collect the brief.** UI kind (`button`, `panel`, `dialog`, `bar`,
   `bar-fill`, `tooltip`, `frame`), art style in the user's words, the largest size the
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
5. **Read the findings** with the table below. Fix every `error`, and compare
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

## Progress bars

A progress or health bar is two pieces made as a matching set: the track
(`--kind bar`) and the fill (`--kind bar-fill`), generated with the same style
words and, when the generator takes references, the track as a reference.

1. Normalize the track with `--mode three` and read its `contentPadding`: the
   fill sits in that box.
2. Normalize the fill to the box's height, `--height <track height - top -
   bottom>`, also with `--mode three`. A fill's soft top-to-bottom shade can
   otherwise pass as a vertical stretch span.
3. Draw progress by resizing the fill. Phaser's NineSlice never gets narrower
   than its two end caps, so below that width keep the caps' width and scale
   the fill down horizontally. The fill follows the track's top-left corner and
   scale, whatever the track's origin. Call it again whenever the track moves,
   resizes, or scales; with both in one Container, moving or scaling the
   Container needs no new call, but changing the track itself still does:

```ts
function setProgress(track, fill, padding, value) {
  const progress = Number.isFinite(value) ? Phaser.Math.Clamp(value, 0, 1) : 0;
  const inner = track.width - padding.left - padding.right;
  const width = Math.round(inner * progress);
  const caps = fill.leftWidth + fill.rightWidth;
  const corner = track.getTopLeft(); // unrotated tracks
  fill.setOrigin(0);
  fill.setPosition(corner.x + padding.left * track.scaleX, corner.y + padding.top * track.scaleY);
  fill.setVisible(width > 0);
  fill.setSize(Math.max(width, caps), fill.height);
  fill.setScale((width >= caps ? 1 : width / caps) * track.scaleX, track.scaleY);
}
const padding = this.textures.getFrame('ui', 'bar').customData.slicewright.contentPadding;
const track = this.add.nineslice(x, y, 'ui', 'bar', 320); // a three-slice keeps its height
const fill = this.add.nineslice(0, 0, 'ui', 'bar-fill');
setProgress(track, fill, padding, 0.4);
```

This keeps the fill exactly inside the track's content box at every width,
checked in Phaser 4.2 at 0 to 100% on two track widths, a centered track, and
a track scaled twice as wide.

In CSS, put the fill element inside the track element: the track's
`border-width` is its content padding, so the fill lands in the content box and
the track's `clientWidth` is the inner width. The fill's `min-width` is its
two end caps, so the same rule applies below it:

```js
function setProgress(track, fill, value) {
  const progress = Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
  const width = Math.round(track.clientWidth * progress);
  const caps = parseFloat(getComputedStyle(fill).minWidth);
  fill.style.visibility = width > 0 ? 'visible' : 'hidden';
  fill.style.width = `${Math.max(width, caps)}px`;
  fill.style.transformOrigin = 'left';
  fill.style.transform = width >= caps ? '' : `scaleX(${width / caps})`;
}
// <div class="ui-bar"><div class="ui-bar-fill"></div></div>
```

Checked in Chrome on the same widths and values. A fill whose look
changes along its length (a left-to-right gradient, segments) cannot be
resized this way, because resizing stretches it: draw it at full width and
reveal part of it instead, for example with a Phaser mask filter. slicewright
does not check that path.

## Findings

| Code | Meaning | Fix |
| --- | --- | --- |
| `stretch.x.nonuniform`, `stretch.y.nonuniform` | Given insets cut into detail, so stretching changes the art. | Widen the insets past the named pair, or let detection pick them. For textured art whose edges vary slightly, `--tolerance` (default 4, try 6 to 12) or `--outlier-ratio 0.02` accepts that texture; regenerating with smoother edges is better. |
| `insets.large` | The fixed parts take most of an axis, so little stretches and the art cannot shrink much. | Usually edge texture or detail: regenerate with plainer edges, or raise `--tolerance` slightly. A pill or capsule is rounded across its whole height: keep the height with `--mode three`. |
| `stretch.x.none`, `stretch.y.none` | No two adjacent lines match; any stretch smears. | Regenerate with plain edges and center, or use `--mode three` for a vertical gradient. |
| `stretch.x.short`, `stretch.y.short` | Only a tiny run matches and nothing repeats: the edges carry non-repeating detail (vines, drawn rope). | Regenerate with plain edges between the corners; or choose insets by hand after the preview. |
| `tile.x.auto`, `tile.y.auto` | The edges repeat with the named period, so that axis tiles. | Create the NineSlice with `tileX` / `tileY`; Phaser reads tiling only from the constructor (the frame's `slicewright.tile` records it). |
| `tile.x.seam`, `tile.y.seam` | A tiled span cuts its pattern or jumps where it wraps. | Use one of the `nearestLengths`, or make the texture seamless. |
| `three-slice.auto` | Rows never repeat, so the layout keeps a fixed height. | Fine for bars. For panels, regenerate with a flat center. |
| `three-slice.vertical.auto` | Columns never repeat but rows do, so the layout keeps its width. | Fine for vertical tracks. For panels, regenerate with plain edges. |
| `regions.multi` | The layout has several stretch regions per axis. | Preview only: no current target exports it. For a speech-bubble tail or a centered crest, generate the shape without it and draw the tail or crest as a separate sprite on top; or re-slice as a nine-slice. |
| `target.unsupported` | The target cannot represent this layout; no files were written. | Pick a target that can, or re-slice as a nine-slice. |
| `target.emulated` | The target has no native form of this layout; the fixed axis has zero insets. | Keep that axis at its source size in the engine. |
| `target.experimental` | The target's output is not yet rendered in its engine. | Check it in the engine before shipping. |
| `target.tile` | The target cannot tile as asked, or counts tiles differently (CSS `round` takes the nearest count; Phaser rounds down). | Check the tiled edge at the sizes you use. |
| `target.fixed` | Nothing in the layout resizes; no files were written. | Use the image as a plain sprite. |
| `noise.tolerance` | Generated art is noisy, so matching tolerance was raised per axis. | Informational. `--noise off` restores exact matching. |
| `noise.high` | The interior is busy along both axes. | Stretching smears it; use a flatter fill or tile it. |
| `alpha.interior` | The middle of the element is partly transparent (alpha below 224). | Fine when intended (glass, a shadow, a glow). If not, a generator faked alpha: regenerate on a chroma key and run `key`. |
| `alpha.chroma-spill` | The alpha edge is tinted by the key color. | Re-run `key` with a lower `--keep`, or despill elsewhere. |
| `margin.transparent` | Transparent border pixels become part of the corners. | `normalize` crops them; otherwise crop unless the spacing is intended. |
| `resize.thin-lines` | An outline drawn straight onto the fill is narrower than the downscale can keep, so it fades (area) or can drop out (nearest). | Ask for outlines at least the named thickness in the source, or normalize to a larger size. |
| `rebuild.x.lossy`, `rebuild.y.lossy` | `--keep` would flatten texture or shading on that axis. | Informational: that axis kept its full span. |
| `rebuild.filtering` | A small `--keep` fades under linear texture filtering. | Use `--keep 8` or more, or nearest filtering (Phaser `pixelArt`). |
| `padding.invalid` | Given content padding leaves no content area, is not whole and non-negative, or reaches past the fixed edge into a stretch span, where it would change with size. | Shrink `--padding` to within the insets on resizable axes. |
| `pack.css-skipped` | A packed frame has no CSS class: it has no borders, or is only part of its image, which `border-image` cannot address. | Pack the piece's own one-frame atlas, or use Phaser for it. |
| `pack.css-class-collision` | Two frame names become the same CSS class. | Rename one piece. |
| `atlas.padding-invalid` | An atlas frame's content padding does not fit the frame or reaches past the fixed edge its `scale9Borders` leave. | Re-export the frame. |
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

Place text inside the content padding, not the slice insets. The padding ends
exactly where the frame does, so keep a margin of about 8 px for text, and
more where corner ornaments reach inward:

```ts
const padding = this.textures.getFrame('ui', 'panel').customData.slicewright.contentPadding;
const margin = 8; // breathing room between text and the frame
const corner = panel.getTopLeft(); // works for any origin
this.add.text(corner.x + padding.left + margin, corner.y + padding.top + margin, 'Hello', style)
  .setWordWrapWidth(panel.width - padding.left - padding.right - margin * 2);
```

`scale9Borders` is the stretchable center rectangle `{ x, y, w, h }`. A frame
whose `y` is 0 and `h` equals the frame height is a three-slice and its height
cannot change. For a `tile.<axis>.auto` finding, pass `tileX` / `tileY` as the
last NineSlice constructor arguments; `export --target phaser` prints the call. Extrude or pad atlas frames by 1 to 2 px
so linear filtering does not bleed neighbors into the seams.
