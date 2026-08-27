---
'archprint': minor
---

Add two AST usage-based rule families over a new shared usage-scanner: console isolation (library / non-CLI
code must not call `console.*`) and env access (read `process.env` only in the config/env layer). Both are
Wilson-gated and emit scoped ESLint flat-config blocks (`no-console`, `no-restricted-properties`) via
`archprint generate`. This is Archprint's first analysis beyond the import graph.
