---
npm/slicewright: patch
---

A multi-region layout's `regions.multi` finding, and the `target.unsupported` error on export, now say to draw the fixed detail, such as a crest or a tail, as its own sprite. The body is a nine-slice when both axes still resize, a three-slice when only the width does, and a vertical three-slice when only the height does. No target can export more than one stretch region per axis.
