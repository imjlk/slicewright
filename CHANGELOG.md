# Changelog

## 0.3.0 — 2026-10-26

### Added

- [6b29f13](https://github.com/imjlk/slicewright/commit/6b29f13eccc503ea00de599e73e07fc0dd813231) `preview` adds a diagnostics cell that marks where findings are: the first differing stretch lines in red, tiled-span seam ends in red, and partly transparent interior pixels in yellow. `alpha.interior` now reports the interior `region` it checked. — Thanks @imjlk!
- [18f7d77](https://github.com/imjlk/slicewright/commit/18f7d77e4ddde7b61120c8170521a3b2aa8f0cb7) `prompt --from <report.json>` appends a correction line for each warning or error in an earlier inspect, normalize, compare, or build report, and lists them as `corrections`. — Thanks @imjlk!
- [2c0f658](https://github.com/imjlk/slicewright/commit/2c0f658b646ba957060cf145d78f40ddc9ac6b4f) `--pixel-art` for inspect and normalize finds the grid of upscaled pixel art (scale, offset, native size), warns about off-grid pixels, and lets normalize snap the art to one pixel per cell before a nearest resize. — Thanks @imjlk!
- [7759bda](https://github.com/imjlk/slicewright/commit/7759bdad83bfc8f474b9207ec79ecb47dcd3e902) `normalize --keep` (and build `keep`) now rebuilds multi-region layouts: every stretch segment keeps its first lines, the fixed detail between spans stays, and the report carries the rebuilt layout. — Thanks @imjlk!
- [1d9670b](https://github.com/imjlk/slicewright/commit/1d9670be77a99b7a8be157570e910b3772150101) Build manifests take `groups` of piece states: after normalizing, each group is compared as states, a mismatch fails the build without packing, and `sharedInsets: true` normalizes the states again with their shared insets. The build report lists the groups. — Thanks @imjlk!
- [30576eb](https://github.com/imjlk/slicewright/commit/30576ebbcd1f29bee12d4bd108d1dcfea08de975) `inspect --watch` and `preview --watch` run again whenever the image changes, printing one JSON line per run, with the same watching rules and exit status as `build --watch`. — Thanks @imjlk!

### Fixed

- [65c88ff](https://github.com/imjlk/slicewright/commit/65c88ff15e3c8c09ab169830ef44ad7575c25f2e) Aseprite slice checks now reject a `sourceSize` that is not a positive whole-pixel size, and a slice with two keys at one frame (`aseprite.key-duplicate`). `build` refuses, before writing anything, an output under an existing file, a piece written through a dangling symlink onto another output, and a hard link to an input. `build --watch` watches where a dangling input symlink will point, and re-arms itself when a watched directory is replaced as a whole. — Thanks @imjlk!

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
