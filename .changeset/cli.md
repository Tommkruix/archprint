---
'archprint': minor
---

Add the CLI: `archprint scan | generate | explain | approve` (commander), wiring the full pipeline so a
repo is scanned, its markers inferred, patterns gated, and rule artifacts emitted end to end.

`scan` and `explain` are specifier-level by default (about a second on a few-thousand-file repo), with
`--deep` to resolve imports through barrels and aliases. `generate` and `approve` resolve the graph by
default (the commitment point should not mint an AUTO rule the full graph would reject), with a `--fast`
opt-out that warns to confirm with a deep pass before enforcing.

Internally, `detectForbiddenImports` runs several patterns in one shared pass, and `createImportAnalyzer`
takes `{ resolve: false }` to skip module resolution and the type checker. The fast path matches only at
the import-specifier level, so barrel/alias-hidden imports are not caught in that mode (disclosed in the
fast-scan report footer); the emitted rule enforces at the specifier level regardless, which its rule card
documents.
