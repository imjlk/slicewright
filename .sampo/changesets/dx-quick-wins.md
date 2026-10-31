---
npm/slicewright: patch (Fixed)
---

Create missing output folders for every command that writes a file, always report the normalized `layout` so any normalize report works with `--layout`, report `insetsSource: "layout"` for a given layout, refuse cross-drive image references on Windows with a request for `--image-ref`, warn with `target.image-ref` when a Godot texture path leaves the project, name the missing `@playwright/test` peer and the artifact folder `browser-report` expects, and add examples and clearer option text to `--help`.
