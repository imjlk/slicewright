---
npm/slicewright: minor (Added)
---

The browser regression guidance is now its own agent skill, `slicewright-browser`, scoped to `slicewright/browser` and `slicewright/playwright`. The `slicewright` skill's description now covers only nine-slice and three-slice game UI art, so general browser or Playwright tasks no longer trigger it. `npx skills add imjlk/slicewright` offers both (`--skill` picks one), the Claude Code marketplace lists each as its own plugin, and both skills declare `compatibility` as a top-level field. Manual installs that linked `skills/slicewright` for browser checks should also link `skills/slicewright-browser`.
