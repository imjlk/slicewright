---
npm/slicewright: minor
---

Agent mode: when gunshi's `getAgentProfile()` detects an AI coding agent (or `AI_AGENT=<name>` is set), `--help` is concise and plain. It gives one line per command, or per argument and option with its type, choices, default and `--[no-]` form, then the examples, with no ANSI codes in help or error messages. `SLICEWRIGHT_AGENT=1` forces agent mode and `SLICEWRIGHT_AGENT=0` turns it off. Command output and exit codes are unchanged.
