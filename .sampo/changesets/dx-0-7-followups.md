---
npm/slicewright: patch
---

`build` reports keep each Unity and Defold export's `usage` text again. A command's `--help` now shows `[options]` in its usage line, marks required options with `(required)`, and ends with its exit codes, as the agent-mode help does. An unknown option before or after a command name (`slicewright --bogus inspect x.png`) prints only the unknown-option message, without a spurious unknown command or missing argument. A layout, report, atlas, or build manifest that is not valid JSON is named with the parser's reason (`--layout x.json is not valid JSON (...)`). `normalize --pixel-art` no longer suggests `--pixel-art` in its snapped note, and `prompt` names only the missing `--kind` or `--style`. `complete` is listed in `slicewright commands` and the agent-mode help. The build skill reference now says that only error-level findings fail a build; inset and padding differences are warnings.
