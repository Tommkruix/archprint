---
'archprint': minor
---

Add entry-point purity, a new rule family: framework file-convention entries (pages, routes, layouts, API
handlers) are loaded by the framework and should not be imported by other first-party code. `detectEntryPurity`
counts entries with a non-zero first-party in-degree and gates the rule with the Wilson floor; `archprint
generate` writes `dependency-cruiser.entry-purity.archprint.json`.
