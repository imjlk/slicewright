# Changelog

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
