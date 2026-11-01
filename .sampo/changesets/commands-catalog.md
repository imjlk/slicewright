---
npm/slicewright: minor
---

New `slicewright commands [name]` prints every command as JSON: its usage line, arguments, options (type, required, default, choices, description, negatable, short form, second names), the exit codes it can end with, and its examples. It reads the same definitions the parser runs, so agents can trust it over docs for the installed version.
