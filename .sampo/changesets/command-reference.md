---
npm/slicewright: patch
---

`docs/commands.md` lists every command's `--help`, generated from the command definitions by gunshi's `generate()` (`pnpm docs:commands`), and a test keeps it current. Parse errors that gunshi 1.0 introduces (a flag given without its value, or a value given to `--no-<flag>`) get the same plain usage messages as the rest.
