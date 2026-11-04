---
'archprint': minor
---

`archprint generate` no longer adds a new break to an adopted rule's exceptions. Earlier, each run rebuilt the exceptions from the current code, so a violation that had been merged (`check` only warns unless `--fail-on new`) became a permanent exception the next time anyone ran `generate`, without a word. On a small repo the same slip could drop the rule instead. Each adopted rule now records its exceptions in `.archprint/config.json`. When a file breaks an adopted rule and was not one of them, `generate` stops, names the rule and the file, and writes nothing, so the rules already in `.archprint/` stay in force. Fix the file, or accept it with `archprint allow <rule> <file> --reason "..."`. When an exception is fixed, the next `generate` enforces the rule on that file and lists it. Rules adopted by an earlier version have their current exceptions recorded on the first run, which lists every one. `generate --reset` starts afresh.
