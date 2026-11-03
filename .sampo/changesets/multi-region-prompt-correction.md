---
npm/slicewright: patch
---

`prompt --from` now adds a correction for a `regions.multi` finding, even though that finding is informational: keep the crest or tail out of the next image and draw it afterwards as its own sprite. Other info findings, and export codes such as `target.unsupported`, still add none.
