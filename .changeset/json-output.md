---
'archprint': minor
---

Add machine-readable output (roadmap B4). `scan --json` emits a stable, serializable summary (per app: file and
alias counts, plus each non-rejected rule with its family, status, observed conformance, confidence floor,
observations, and violating-file count), and `recommend --json` emits the three recommendation tiers as JSON.
Both are keyed by `archprintVersion` for forward compatibility, making archprint scriptable in CI. Exit codes are
the documented contract: 0 on success, 1 on error or refusal. SARIF is intentionally left to the tools archprint
emits into (eslint and dependency-cruiser already produce it) rather than reimplemented here.
