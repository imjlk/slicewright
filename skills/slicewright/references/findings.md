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
| `alpha.chroma-spill` | The alpha edge is tinted by the key color. | Re-run `key` with a lower `--keep`, or despill elsewhere. |
| `margin.transparent` | Transparent border pixels become part of the corners. | `normalize` crops them; otherwise crop unless the spacing is intended. |
| `resize.thin-lines` | An outline drawn straight onto the fill is narrower than the downscale can keep, so it fades (area) or can drop out (nearest). | Ask for outlines at least the named thickness in the source, or normalize to a larger size. |
| `rebuild.x.lossy`, `rebuild.y.lossy` | `--keep` would flatten texture or shading on that axis. | Informational: that axis kept its full span. |
| `rebuild.filtering` | A small `--keep` fades under linear texture filtering. | Use `--keep 8` or more, or nearest filtering (Phaser `pixelArt`). |
| `padding.invalid` | Given content padding leaves no content area, is not whole and non-negative, or reaches past the fixed edge into a stretch span, where it would change with size. | Shrink `--padding` to within the insets on resizable axes. |
| `pack.css-skipped` | A packed frame has no CSS class: it has no borders, or is only part of its image, which `border-image` cannot address. | Pack the piece's own one-frame atlas, or use Phaser for it. |
| `pack.css-class-collision` | Two frame names become the same CSS class. | Rename one piece. |
| `compare.size`, `compare.mode`, `compare.tile` | States of one element differ in size, slice mode, or tiled axes, so they cannot swap in one NineSlice. | Normalize every state to the same size and regenerate the odd one out. |
| `compare.insets`, `compare.padding` | States' detected insets or content padding differ by more than `--slack`; corners or text would jump on swap. | Use `sharedInsets` for every state, or regenerate the state that drifted. |
| `compare.shared-insets` | The largest insets on each side do not fit every state. | Regenerate the states so their edge detail lines up. |
| `compare.outline` | Pieces' outline thicknesses differ by more than 1 px and a quarter. | Regenerate the odd piece, or normalize it to a size that matches the others' line weight. |
| `compare.outline-missing` | Some pieces have no measurable outline. | Informational; compare their line weight by eye in the preview. |
| `atlas.padding-invalid` | An atlas frame's content padding does not fit the frame or reaches past the fixed edge its `scale9Borders` leave. | Re-export the frame. |
| `insets.asymmetric` | Opposite insets differ by more than 2 px. | Usually generator drift; check the preview. |
| `insets.invalid` | Insets leave no stretch pixel. | Shrink the insets. |
| `image.empty` | Every pixel is transparent. | The background removal took everything; redo it. |
| `atlas.trimmed` | Phaser NineSlice does not support trimmed frames. | Disable trimming for this sprite and repack. |
| `atlas.rotated` | Rotated frames are not a tested NineSlice input. | Disable rotation for this sprite. |
| `atlas.borders-outside-frame` | `scale9Borders` does not fit the frame. | Re-export the borders. |
