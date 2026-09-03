---
'archprint': minor
---

Make `archprint explain` actionable (roadmap B2). Each explanation now shows, below the gate breakdown, a
codeframe for every exception (the offending import line with its line number), a "How to fix" line, a "When
not to use this" caveat, and a "How to enforce" line that names the exact next command for the rule's gate
status. Per-rule guidance lives in a single `rule-guidance` source and the codeframe reader is a small,
self-contained module.
