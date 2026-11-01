---
npm/slicewright: minor
---

Shell completion: `slicewright complete <bash|zsh|fish|powershell>` prints a completion script (through `@gunshi/plugin-completion`). Commands, options, enum choices, `--target` names, `commands <name>`, and image, JSON, or directory paths complete with Tab. A missing or unknown shell is a usage error (exit 2). Every other command still prints JSON only, and `complete` stays out of the command catalog and agent-mode help.
