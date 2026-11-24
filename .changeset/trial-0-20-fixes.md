---
'archprint': patch
---

- `generate --check` names a rule your ESLint config turns off only for the files the rule applies to. Before, it also counted test files a rule skips and folders it never covers, so turning a rule off for a folder it does not apply to (`AP-001` for `lib/**`, or a CLAUDE.md rule for a folder its sentence does not name) failed the check.
- `generate` says which rules it adopted in this run ("Adopted 1 rule(s): console-isolation"), including a rule removed earlier and adopted again with `--rules`.
- `generate` no longer prints "Refreshed: removed 1 stale archprint output(s)" when it rewrote the same files; it names only outputs it no longer writes.
- `check`'s burn-down line counts the files a freeze rule keeps as they are apart from the exceptions left to fix: "Exceptions: 2 left. Not counted: 38 file(s) a freeze rule allows as they are."
