---
npm/slicewright: minor
---

Developer experience follow-ups to 0.6.0:

- A missing input file is reported as `<path> does not exist.` instead of a system error, for every command; a build names the piece (`pieces[0].input`), `--layout` names the flag, and an atlas whose image is missing names its `meta.image`.
- A layout file that is not a layout now says what it should hold and lists its first problems in words, instead of typia's text and the outdated `--insets` advice.
- `--pixel-scale` that fits the art's edges poorly (below 0.85) adds a `pixel.scale-mismatch` warning suggesting the whole scales that fit.
- `--target` typos (on the command line and in a manifest) suggest the closest target; `key` threshold errors name the flags as you typed them; `prompt` mentions `--from` only when you used it; the missing diagnostics cell error reads plainly.
- Preview, frame, export, and normalize reports include `insetsSource`.
- Help: examples for the program and `targets`, no `[slicewright] <OPTIONS>` row, a real description for `--no-crop`, and each command's own options before `--help` and `--version`.
- The README quickstart now creates the button it packs, and the skill notes that `pack` takes the atlas JSON from `normalize --target phaser` or `--atlas`.

Compatibility: `slicewright targets` now prints `{"targets": [...]}` instead of a bare array; read `.targets`. Paths in `build` reports (and `build --watch`) are now relative to the manifest's directory, as the manifest gives them, instead of absolute; a path on another drive stays absolute.
