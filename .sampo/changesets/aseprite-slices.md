---
npm/slicewright: minor (Added)
---

`slicewright atlas` recognizes an Aseprite sheet (`--sheet --data --list-slices`) and checks each slice's 9-slice `center` against the pixels of every frame its keys cover, mapping bounds through trimmed frames and reporting the insets and pivot. `--slice` picks one slice. The check is also exported as `inspectAsepriteSlices` and `isAsepriteSheet`.
