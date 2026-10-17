---
npm/slicewright: minor (Added)
---

Experimental `unity`, `defold`, and `godot` export targets. `unity` prints the sprite border in `TextureImporter.spriteBorder` order (`x = left, y = bottom, z = right, w = top`) and writes no file, never touching `.meta` files. `defold` prints `slice9` (left, top, right, bottom) for sprites and GUI box nodes. `godot` writes a Godot 4 `StyleBoxTexture` `.tres` with texture and content margins and per-axis stretch modes, and prints the matching `NinePatchRect` properties. All three are marked `experimental` in `slicewright targets`, and every export carries a `target.experimental` finding.
