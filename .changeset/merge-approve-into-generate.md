---
'archprint': minor
---

Merge `approve` into `generate --rule <id>`. Emitting a single reviewed rule (including a SUGGEST rule) was a
special case of generate, and having two commands that both write rule artifacts was the one genuinely ambiguous
pair in the CLI. Now `archprint generate --rule AP-001` does what `archprint approve AP-001` did; the standalone
`approve` command is removed. Naming the rule is the explicit consent, so the AUTO-is-automatic /
SUGGEST-needs-review distinction is preserved. This drops the command surface from 8 to 7. Done pre-1.0, before
the surface is public.
