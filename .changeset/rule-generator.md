---
'archprint': minor
---

Add the rule generator: from an AUTO-gated detected pattern, emit four artifacts (ESLint rule `.ts`,
rule card `.md` with the evidence attached, plus passing and failing fixtures). The emitted rule is
self-contained plain ESLint (no `@typescript-eslint` runtime dependency) and enforces the detector's
direct-import semantics. Validated by RuleTester and an independent scratch-project run.
