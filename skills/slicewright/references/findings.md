# Findings

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
| `alpha.chroma-spill` | The alpha edge is tinted by the key color. | Re-run `key` with a lower `--keep-below` (`--keep`), or despill elsewhere. |
| `margin.transparent` | Transparent border pixels become part of the corners. | `normalize` crops them; otherwise crop unless the spacing is intended. |
| `resize.thin-lines` | An outline drawn straight onto the fill is narrower than the downscale can keep, so it fades (area) or can drop out (nearest). | Ask for outlines at least the named thickness in the source, or normalize to a larger size. |
| `rebuild.x.lossy`, `rebuild.y.lossy` | `--keep` would flatten texture or shading on that axis. | Informational: that axis kept its full span. |
| `pixel.upscaled` | `--pixel-art` found a grid (or `--pixel-scale` placed it): each art pixel is a block of about `scale` image pixels. | `normalize --pixel-art` snaps it to `native` size and resizes with nearest sampling; or resize by `1/scale` with `--filter nearest`. |
| `pixel.off-grid` | More than 10% of pixels differ from their grid cell (blur, anti-aliasing, or a non-pixel-art style). | Regenerate as crisp pixel art with no anti-aliasing; snapping keeps only each cell's center color. |
| `pixel.no-grid` | `--pixel-art` found no grid coarser than one pixel. | The art is already at its native size, or not pixel art; resize with `--filter nearest` if it is. |
| `pixel.grid-undetermined` | Flat pixel art (a frame and one fill) has too few color edges to tell its scale; `candidate` is the largest scale every edge lies on, and the real scale may be it or a divisor. | Give the scale the art was drawn at: `normalize --pixel-scale 6` snaps it; nothing is snapped without it. |
| `rebuild.filtering` | A small `--keep` fades under linear texture filtering. | Use `--keep 8` or more, or nearest filtering (Phaser `pixelArt`). |
| `padding.clamped` | The frame's inner edge lies inside a stretch span on some side, so the detected content padding stops at the fixed edge there; content may overlap that part of the frame. | Informational. Check text placement in the preview; regenerate with a plainer, thinner inner border, or give `--padding` within the insets. |
| `padding.invalid` | Given content padding leaves no content area, is not whole and non-negative, or reaches past the fixed edge into a stretch span, where it would change with size. | Shrink `--padding` to within the insets on resizable axes. |
| `pack.css-skipped` | A packed frame has no CSS class: it has no borders, or is only part of its image, which `border-image` cannot address. | Pack the piece's own one-frame atlas, or use Phaser for it. |
| `pack.css-class-collision` | Two frame names become the same CSS class. | Rename one piece. |
| `compare.size`, `compare.mode`, `compare.tile` | States of one element differ in size, slice mode, or tiled axes, so they cannot swap in one NineSlice. | Normalize every state to the same size and regenerate the odd one out. |
| `compare.insets`, `compare.padding` | States' detected insets or content padding differ by more than `--slack`; corners or text would jump on swap. | Use `sharedInsets` for every state, or regenerate the state that drifted. |
| `compare.shared-insets` | The largest insets on each side do not fit every state. | Regenerate the states so their edge detail lines up. |
| `build.group-shared-insets` | A grouped state has errors once normalized with the group's shared insets. | Make the states' frames match, or drop `sharedInsets` from the group and fix the `compare.*` findings. |
| `build.group-layout` | Grouped states normalized to different slice modes or tiled axes, so they cannot swap in one slice. | Give every state the same `mode` and `tile`, or regenerate the odd one out. |
| `build.group-size` | With `sharedInsets`, the states ended up different sizes. | Normalize every state to the same final size before the build. |
| `compare.outline` | Pieces' outline thicknesses differ by more than 1 px and a quarter. | Regenerate the odd piece, or normalize it to a size that matches the others' line weight. |
| `compare.outline-missing` | Some pieces have no measurable outline. | Informational; compare their line weight by eye in the preview. |
| `atlas.padding-invalid` | An atlas frame's content padding does not fit the frame or reaches past the fixed edge its `scale9Borders` leave. | Re-export the frame. |
| `insets.asymmetric` | Opposite insets differ by more than 2 px. | Usually generator drift; check the preview. |
| `insets.invalid` | Insets leave no stretch pixel. | Shrink the insets. |
| `image.empty` | Every pixel is transparent. | The background removal took everything; redo it. |
| `atlas.trimmed` | Phaser NineSlice does not support trimmed frames. | Disable trimming for this sprite and repack. |
| `atlas.rotated` | Rotated frames are not a tested NineSlice input. | Disable rotation for this sprite. |
| `aseprite.center-invalid` | An Aseprite slice's 9-slice center does not lie inside its bounds. | Redraw the center in Aseprite's slice tool. |
| `aseprite.bounds-outside-frame` | A slice reaches past its frame, usually because the sheet was trimmed. | Export without trimming, or shrink the slice. |
| `aseprite.bounds-invalid` | A slice key's bounds are not a whole-pixel rectangle with a positive size. | Redraw the slice in Aseprite, or fix the bounds in the JSON. |
| `aseprite.rotated` | A frame a slice covers is rotated in the sheet. | Re-export the sheet without rotation. |
| `aseprite.frame-missing` | A slice key starts past the sheet's last frame. | Export every frame (no `--frame-range` or tag filter that drops them), or move the key in Aseprite. |
| `aseprite.no-center`, `aseprite.no-slices` | A slice has no 9-slice center, or the sheet has no slices to check. | Enable 9-slices on the slice, or export with `--list-slices`. |
| `atlas.borders-outside-frame` | `scale9Borders` does not fit the frame. | Re-export the borders. |
