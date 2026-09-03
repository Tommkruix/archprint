---
'archprint': minor
---

Grandfather known exceptions in the generated AP- eslint rules (roadmap B3). An AUTO rule is inferred because the
code already follows it apart from at most a few exception files; the generated plugin rule now skips exactly
those files, so wiring the rule and running the linter is green on the current codebase (no red wall on day one)
while any new violation elsewhere is still caught, the standard ratchet. The exceptions remain visible in `scan`
and `explain`; only enforcement grandfathers them. Proven end-to-end: the exception file passes and the same
violation in a new file is flagged by the real eslint engine.
