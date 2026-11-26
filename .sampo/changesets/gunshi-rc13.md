---
npm/slicewright: minor
---

Upgrade gunshi and `@gunshi/plugin-completion` to 1.0.0-rc.13. Human `--help` now shows option values as `<name>` (`--out <out>`), names the options a command requires in its usage line and in the program's command list (`normalize --out <out> <input>`), and ends with a single `slicewright <COMMAND> --help` pointer. An extra argument a command does not take is now a usage error (`inspect a.png b.png` says `Unexpected argument "b.png" for inspect` and exits 2) rather than running with only the words it takes. Parsing of the arguments a command does take, other error messages, exit codes, agent mode, the `commands` JSON catalog, and shell completion are unchanged.
