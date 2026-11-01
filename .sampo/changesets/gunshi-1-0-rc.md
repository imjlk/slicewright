---
npm/slicewright: patch
---

Upgrade `gunshi` and `@gunshi/plugin-completion` to `1.0.0-rc.1`. The program's `--help` now shows each command's arguments (for example `inspect <input>`), and options given before the command name (`--tolerance 3 inspect x.png`) are parsed instead of rejected. Shell completion also offers `--help`, `--version`, and `--no-<flag>`. A flag with no value and a value given to a negated flag get readable messages.
