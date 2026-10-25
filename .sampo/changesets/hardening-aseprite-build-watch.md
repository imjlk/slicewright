---
npm/slicewright: patch (Fixed)
---

Aseprite slice checks now reject a `sourceSize` that is not a positive whole-pixel size, and a slice with two keys at one frame (`aseprite.key-duplicate`). `build` refuses, before writing anything, an output under an existing file, a piece written through a dangling symlink onto another output, and a hard link to an input. `build --watch` watches where a dangling input symlink will point, and re-arms itself when a watched directory is replaced as a whole.
