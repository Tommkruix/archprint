---
'archprint': patch
---

The MCP `archprint_scan` and `archprint_explain` results now say, for each rule, whether archprint enforces it, holds it for review, or only reports it (`adoption`: `enforce`, `review` or `report-only`). Before, they gave only the gate status (AUTO or SUGGEST), and agents described rules archprint holds for review as enforced.
