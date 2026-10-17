---
npm/slicewright: patch (Fixed)
---

`build` now checks every file a piece's export targets write, such as a Godot `.tres`, for path collisions before writing anything. Targets declare their output files for this check.
