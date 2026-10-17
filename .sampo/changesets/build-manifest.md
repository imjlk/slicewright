---
npm/slicewright: minor (Added)
---

`slicewright build <manifest.json>` normalizes every piece a manifest lists, writes each with its one-frame atlas and any exports, and packs them into one atlas, so a whole set rebuilds with one command. The manifest is validated with typia (unknown keys refused) before anything is written, a build never writes over its own inputs, and nothing is packed when a piece fails. `--watch` rebuilds when the manifest or a piece's PNG changes, using `fs.watch` with no new dependencies. Also exported as `readBuildManifest`, `loadBuildManifest`, `runBuild`, and `buildInputs`.
