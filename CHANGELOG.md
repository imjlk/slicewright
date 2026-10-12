# Changelog

## 0.1.0

First release.

- Prompt plans for buttons, panels, dialogs, bars and bar fills, tooltips,
  and frames.
- Chroma-key removal with despill, premultiplied area and nearest resizing,
  and `normalize` (crop, resize, inset detection, optional minimal rebuild).
- Inset detection for nine-slice, three-slice, vertical three-slice,
  repeating (tiled) edges, and multiple stretch regions, with findings for
  smearing, seams, noise, interior alpha, chroma spill, margins, thin lines lost
  to downscaling, and content padding.
- Preview sheets with cell selection, zoom, and wrapped rows.
- Phaser 4 (`scale9Borders` atlases) and CSS `border-image` targets, both
  checked in the real engines; atlas checking and packing.
- An agent skill (`skills/slicewright`).
