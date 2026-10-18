# Changelog

## 0.2.1 — 2026-10-19

### Fixed

- [f473e80](https://github.com/imjlk/slicewright/commit/f473e800bdcf470df0213c5e6d8186579257a8c8) `build` now checks every file a piece's export targets write, such as a Godot `.tres`, for path collisions before writing anything. Targets declare their output files for this check. — Thanks @imjlk!

## 0.2.0 — 2026-10-18

### Added

- [785d762](https://github.com/imjlk/slicewright/commit/785d76266cac106fae0fb2caa365caf94a68ad44) `slicewright atlas` recognizes an Aseprite sheet (`--sheet --data --list-slices`) and checks each slice's 9-slice `center` against the pixels of every frame its keys cover, mapping bounds through trimmed frames and reporting the insets and pivot. `--slice` picks one slice. The check is also exported as `inspectAsepriteSlices` and `isAsepriteSheet`. — Thanks @imjlk!
- [bde5363](https://github.com/imjlk/slicewright/commit/bde53635113f2f3713a2ed6af95e6f21998bcc0b) Experimental `unity`, `defold`, and `godot` export targets. `unity` prints the sprite border in `TextureImporter.spriteBorder` order (`x = left, y = bottom, z = right, w = top`) and writes no file, never touching `.meta` files. `defold` prints `slice9` (left, top, right, bottom) for sprites and GUI box nodes. `godot` writes a Godot 4 `StyleBoxTexture` `.tres` with texture and content margins and per-axis stretch modes, and prints the matching `NinePatchRect` properties. All three are marked `experimental` in `slicewright targets`, and every export carries a `target.experimental` finding. — Thanks @imjlk!
- [03f385f](https://github.com/imjlk/slicewright/commit/03f385f5da57dff549af2850bf4196033ff6e96a) `slicewright compare` checks several PNGs against each other. States of one element must share a size and slice mode, detected insets and content padding must agree within `--slack` pixels, and the largest insets on each side (`sharedInsets`) must fit every state. With `--kind set`, the pieces of a matching set are compared only by outline weight. The comparison is also exported as `compareSet`. — Thanks @imjlk!
- [0592c38](https://github.com/imjlk/slicewright/commit/0592c381568eb4355908137dfa517802bdee2978) `slicewright build <manifest.json>` normalizes every piece a manifest lists, writes each with its one-frame atlas and any exports, and packs them into one atlas, so a whole set rebuilds with one command. The manifest is validated with typia (unknown keys refused) before anything is written, a build never writes over its own inputs, and nothing is packed when a piece fails. `--watch` rebuilds when the manifest or a piece's PNG changes, using `fs.watch` with no new dependencies. Also exported as `readBuildManifest`, `loadBuildManifest`, `runBuild`, and `buildInputs`. — Thanks @imjlk!

### Changed

- [5371afd](https://github.com/imjlk/slicewright/commit/5371afd425253cfa5d9aeda98557f7d997650608) The agent skill keeps its workflow in `SKILL.md` and moves the findings table, Phaser 4 usage, progress bars, and speech bubbles into `skills/slicewright/references/`. It now states one way to run the CLI (`npx -y slicewright`, which prefers the project's installed copy), drops the undefined `$SLICEWRIGHT_ROOT`, and declares `license` and `compatibility`. The repository is also a Claude Code plugin marketplace, and the README covers `npx skills add`, the plugin, and manual installs. — Thanks @imjlk!

## 0.1.0 — 2026-10-12

First release.

- Prompt plans for buttons, panels, dialogs, bars and bar fills, tooltips,
  speech-bubble bodies and their separate tails, and frames.
- Chroma-key removal with despill, premultiplied area and nearest resizing,
  `resize --match-outline` to scale a separate piece (a bubble tail) so its
  outline matches another image's, and `normalize` (crop, resize, inset
  detection, optional minimal rebuild).
- Inset detection for nine-slice, three-slice, vertical three-slice,
  repeating (tiled) edges, and multiple stretch regions, with findings for
  smearing, seams, noise, interior alpha, chroma spill, margins, thin lines lost
  to downscaling, and content padding.
- Preview sheets with cell selection, zoom, and wrapped rows.
- Phaser 4 (`scale9Borders` atlases) and CSS `border-image` targets, both
  checked in the real engines; atlas checking and packing (atlases and plain
  PNGs into one atlas and stylesheet).
- An agent skill (`skills/slicewright`).
