---
'archprint': patch
---

Fix four more Phase A1 re-audit findings in the structural families: server-client is REJECTed as vacuous when
no `server-only` module exists anywhere; `.e2e-spec` files and `__tests__`/`test`/`e2e`/`cypress`/`playwright`
directories are classified as tests (so test scaffolding no longer forms bogus layers); generated code
(`generated/**`) is neutral so a component importing generated enums is not a false data-layer violation; and
an entry re-exporting another entry (idiomatic route aliasing) no longer breaks entry-purity.
