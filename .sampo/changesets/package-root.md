---
npm/slicewright: minor
---

The package root no longer re-exports every module. It exports the art pipeline (PNG, chroma, resize, inspect, layout, prompt, normalize, preview, compare, pack, build, Phaser and Aseprite sheets, and target export) and not the CLI argument helpers. `slicewright/browser` and `slicewright/playwright` are unchanged.
