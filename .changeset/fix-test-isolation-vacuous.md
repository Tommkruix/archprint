---
'archprint': patch
---

Make the test-isolation gate REJECT when an app has no test files at all, instead of vacuously passing as
AUTO. `generate`/`recommend` already suppressed this case at the surface, but the detector's own gate now
reports it honestly, so every consumer of the gate status is consistent. Surfaced by the Phase A1 round-3 audit.
