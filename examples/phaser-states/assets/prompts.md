# Original button-state generation prompts

These are the original image-tool prompts, before normalization and packing.
Generation did not preserve pixel-identical alpha boundaries; see ../README.md.

## normal

```text
Use case: stylized-concept
Asset type: a production game UI button background, NORMAL state, one individual transparent PNG.
Input image 1 is STYLE REFERENCE ONLY: reuse its cheerful bright storybook RPG palette, honey oak, polished brass, and substantial warm-brown outlines. Create a new simpler button, not another panel.
Subject: one blank wide horizontal rounded-rectangle button, straight-on orthographic front view. Actual button silhouette has aspect ratio 3.5:1, intended to render around 224 by 64 logical pixels. Warm honey-oak outer rim with a simple slim brass inner bevel; a large muted forest-green center for runtime Korean text. Modestly rounded corners. No ornament on this button.
Composition: center the complete button on a genuinely transparent canvas, with only modest clear margin around all sides. Single complete element, no other states, no mockup, no scene.
Slice requirements: keep left and right caps compact. Across the middle 70 percent of the width, the top and bottom rim must be perfectly straight, smooth continuous bands with exactly the same cross-section at every horizontal position. The center is one uniform opaque forest-green fill. Keep decorative modeling confined to the compact end caps; no texture, grain, bright spots, line irregularity, or gradients along the horizontal stretch direction. A shallow clean bevel may have consistent vertical shading, identical across the straight span.
Style: polished hand-painted fantasy UI matching the reference's warmth, simplified to remain clean and legible at 224 by 64. Substantial clean outline.
Text: none. The entire green center is empty.
Avoid: letters, symbols, icons, numbers, leaf ornaments, gemstones, corner badges, rivets, grain along the long edges, rope, vines, scratches, patterns, drop shadows outside the silhouette, cast shadows, glow, perspective, tilt, background, opaque checkerboard, multiple buttons, labels. Preserve real alpha transparency.
```

## hover

```text
Use case: precise-object-edit
Asset type: one real game UI button state as a separate transparent PNG.
Input image 1 is the exact NORMAL button EDIT TARGET, not a style suggestion.
Lock geometry: preserve the existing 1855 by 848 pixel canvas, exact button placement, complete external silhouette, alpha boundary, outer rim thickness, compact end caps, corner curves, all horizontal band boundaries, blank center rectangle, and transparent margins. Do not crop, resize, move, expand, compress, reshape, or add any geometry. This image must swap in place with the normal state in the same game button. Keep every edge location unchanged.
Preserve the matching bright storybook RPG honey-oak/brass style and the center's blank area for runtime Korean text. The straight middle span must remain horizontally uniform: no grain, pattern, textural patches, or horizontal lighting gradient. The center stays opaque. Generate only ONE button and retain real alpha transparency. No text, letters, icons, symbols, extra ornaments, particles, glow outside the silhouette, cast shadows, or background.
State to create: HOVER. Change only the painted colors and bevel highlights inside the existing shape. Make the muted forest-green center clearly a little lighter and fresher (a welcoming sage-forest green), make the existing upper brass bevel softly brighter and the oak rim slightly warmer. Retain restrained contrast suitable behind cream runtime text. This should read as a distinct interactive hover illustration, with no new lines, edging, glows, or extra shapes. Preserve all fixed geometry and the exact alpha boundary.
```

## pressed

```text
Use case: precise-object-edit
Asset type: one real game UI button state as a separate transparent PNG.
Input image 1 is the exact NORMAL button EDIT TARGET, not a style suggestion.
Lock geometry: preserve the existing 1855 by 848 pixel canvas, exact button placement, complete external silhouette, alpha boundary, outer rim thickness, compact end caps, corner curves, all horizontal band boundaries, blank center rectangle, and transparent margins. Do not crop, resize, move, expand, compress, reshape, or add any geometry. This image must swap in place with the normal state in the same game button. Keep every edge location unchanged.
Preserve the matching bright storybook RPG honey-oak/brass style and the center's blank area for runtime Korean text. The straight middle span must remain horizontally uniform: no grain, pattern, textural patches, or horizontal lighting gradient. The center stays opaque. Generate only ONE button and retain real alpha transparency. No text, letters, icons, symbols, extra ornaments, particles, glow outside the silhouette, cast shadows, or background.
State to create: PRESSED (pointer currently held down). Change only the painted colors and inner bevel shading inside the existing shape. Make the green center a clearly darker deep pine green. Paint the existing inner top bevel darker and the existing inner bottom bevel with a restrained warm highlight, suggesting a pressed recess. Darken the oak/brass surfaces a little. Do not shift the button or the center downward, do not alter any band thickness, and do not move the inner or outer boundaries. The pressed effect must be achieved solely by distinct painted shading on the existing geometry. Preserve the exact alpha boundary.
```

## disabled

```text
Use case: precise-object-edit
Asset type: one real game UI button state as a separate transparent PNG.
Input image 1 is the exact NORMAL button EDIT TARGET, not a style suggestion.
Lock geometry: preserve the existing 1855 by 848 pixel canvas, exact button placement, complete external silhouette, alpha boundary, outer rim thickness, compact end caps, corner curves, all horizontal band boundaries, blank center rectangle, and transparent margins. Do not crop, resize, move, expand, compress, reshape, or add any geometry. This image must swap in place with the normal state in the same game button. Keep every edge location unchanged.
Preserve the matching bright storybook RPG honey-oak/brass style and the center's blank area for runtime Korean text. The straight middle span must remain horizontally uniform: no grain, pattern, textural patches, or horizontal lighting gradient. The center stays opaque. Generate only ONE button and retain real alpha transparency. No text, letters, icons, symbols, extra ornaments, particles, glow outside the silhouette, cast shadows, or background.
State to create: DISABLED (unavailable action). Change only the painted colors and highlights inside the existing shape. Desaturate the center to a muted gray-sage green, and turn the honey-oak/brass rim into subdued gray-brown aged wood and dull bronze. Reduce shine and saturation clearly so it reads unavailable, while retaining enough local contrast to see the same bevel structure. Keep every pixel of the asset's opacity and the opaque center; do not fade the whole image to partial transparency. Preserve the exact alpha boundary and all geometry. No overlay, no lock icon, no cross, and no text.
```
