# Changelog

## 0.4.0 — 2026-10-30

### Minor changes

- [dee2996](https://github.com/imjlk/slicewright/commit/dee2996a6b96e78b74c069cdc15b1949f84a3967) Add `expect(target).toBeStableUI()` to wait for sampled visual stability across HTML/CSS, Canvas, and custom browser targets, with duration windows, explicit pixel tolerances, native Playwright deadlines, and failure diagnostics. — Thanks Neo!
- [de5f109](https://github.com/imjlk/slicewright/commit/de5f1096553e793b780066bc50e10e232c479f72) Add an offline, read-only HTML viewer for browser failure artifacts with image comparisons, measured-region overlays, and a browser-report CLI. — Thanks Neo!
- [23be3e1](https://github.com/imjlk/slicewright/commit/23be3e1614fdb3faec84a3d811faf97a004dd5f8) Add explicit browser baseline save and load APIs with versioned metadata, rendering-environment checks, PNG integrity validation, and complete-snapshot replacement for later UI regression tests. — Thanks Neo!
- [d248918](https://github.com/imjlk/slicewright/commit/d248918ac4e83be49053173dddcc7678af08a028) Add optional Playwright Test assertions that wait for DOM and Canvas UI expectations and automatically attach failure images and reports without repeating user input. — Thanks Neo!
- [8df1c04](https://github.com/imjlk/slicewright/commit/8df1c04081c11b75c773b6c82383a541b208f5d2) Add explicit named-region pixel tolerances for DOM and Canvas browser assertions, retaining exact alpha and outside-region checks with per-region diagnostics. — Thanks Neo!
- [d447543](https://github.com/imjlk/slicewright/commit/d447543130480fa7cdb44a7ceb09c8537501ab1e) Observe and assert keyboard focus through the same DOM and Canvas browser API, including focus-visible state and missing-instrumentation diagnostics. — Thanks Neo!
- [072e5bf](https://github.com/imjlk/slicewright/commit/072e5bfd4d9178f44a6871a9c1f8c4c40053fbf4) Add the optional `slicewright/browser` API for verifying HTML/CSS and Canvas UI with the same Playwright-driven interactions, explicit content regions, rendered pixel comparisons, and diagnostic artifacts. — Thanks Neo!
- [7e19dc9](https://github.com/imjlk/slicewright/commit/7e19dc94fcb173f902d0f03a87abf23c0a427d57) Automatically attach offline HTML reports to failed Playwright UI assertions, distinguish negated assertion failures from positive observations, and preserve observed rendering context and supplied environment labels in snapshots, reports, and baselines. — Thanks Neo!

### Fixed

- [654bfe6](https://github.com/imjlk/slicewright/commit/654bfe60c3dd544b9e649ade10d0911f2b160383) Compare custom target measurement records by value so null-prototype records cannot be mistaken for a visual change on the first stability capture. — Thanks Neo!
- [6ae58db](https://github.com/imjlk/slicewright/commit/6ae58db2289d0d7885e730a825f6b28a7416d4ee) Recover missed watch notifications with a lightweight file-metadata fallback, including immediate saves after startup and file replacements that preserve modification times. Stop polling and pending rebuilds when the watch is aborted. — Thanks Neo!

### Patch changes

- [2e41ddd](https://github.com/imjlk/slicewright/commit/2e41ddd1481c17ba48320116695e9b67d5256999) Add a reusable layered UI assembly recipe to the skill, with explicit attachment placement, total content insets, responsive rules, and checks for enlarged multilingual text and decoration input handling. — Thanks Neo!

## 0.3.2 — 2026-10-27

### Patch changes

- [3c6483c](https://github.com/imjlk/slicewright/commit/3c6483cef5a28b14b82b5bbbe7d6e0d0d14cdfb8) Clarify that `--layout` accepts a SliceLayout or a report containing a `layout` field. When a single-region normalize report is passed instead, explain how to reuse its insets, applicable slice mode and tiling options, and optional content padding. — Thanks Neo!
- [b8ca761](https://github.com/imjlk/slicewright/commit/b8ca7619705606084e93266c791b7e4e34dc8d93) Clarify the agent skill's state-family validation: preserve matching source proportions, keep normalized canvases intact, verify shared insets in the final atlas, and use one runtime content box across states. Document consistent matching settings and review of detection warnings after shared insets are applied.
  
  Show how to swap Phaser NineSlice state frames while refreshing their rendered texture coordinates and preserving the button's draw size. — Thanks Neo!

## 0.3.1 — 2026-10-27

### Patch changes

- [d813268](https://github.com/imjlk/slicewright/commit/d813268930d6655185c12097a321077e74b66e98) Guide agents through layered UI made from a stretchable body, fixed ornaments, and runtime content, with explicit attachment coordinates and checked text regions for CSS and Phaser. — Thanks Neo!
- [db3c23a](https://github.com/imjlk/slicewright/commit/db3c23a23597f265a6067ef81d3b3480b155506d) Guide agents to validate real text and controls at intended sizes, with a runnable layered CSS panel example and browser checks for clipping and overlap. — Thanks Neo!
- [4dd6ac3](https://github.com/imjlk/slicewright/commit/4dd6ac37a3b45d5f9b2a32b46a29bedf0ef519a4) The agent skill guides matching UI sets from a shared art brief and accepted reference through separate asset generation, final-scale comparison, and state-family validation with shared insets. It distinguishes visual style review from outline checks and provides command examples that save reports for later checks. — Thanks Neo!

### Changed

- [a745106](https://github.com/imjlk/slicewright/commit/a745106e1b005ecab7647f8ec86b231466e1fa4b) The agent skill documents 0.3 features: build manifests with state groups and `sharedInsets` (new `references/build.md`), `prompt --from` and `--piece`, the preview diagnostics cell, `padding.clamped` and the build group findings, repeating `--mode three` on preview and inspect, and the Node.js 24 requirement. — Thanks @imjlk!

### Fixed

- [9ca7f74](https://github.com/imjlk/slicewright/commit/9ca7f74000d3d518b2a63afd56de39cc38b488a6) `--pixel-art` finds whole-number upscales exactly (a 6x upscale no longer reads as about 6.3x); a multi-region `normalize --keep` report includes its `layout`, which `inspect`, `preview`, `frame`, and `export` read back with `--layout`; an Aseprite sheet lists each slice skipped for having no center as `aseprite.no-center`; `prompt` explains a missing `--kind` or `--style` with `--from`; and the compare corrections no longer call set pieces "states". — Thanks @imjlk!

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
