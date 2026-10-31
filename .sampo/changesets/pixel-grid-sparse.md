---
npm/slicewright: minor (Added)
---

Tell flat pixel art apart from art that is not pixel art: with too few color edges on both axes, `--pixel-art` now reports `pixel.grid-undetermined` with the candidate scale (the largest every edge lies on, and its divisors) instead of `pixel.no-grid`, a sparse axis takes the scale found on the other axis, and the new `--pixel-scale N` option snaps art at a known scale.
