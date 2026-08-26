---
'archprint': minor
---

Add layer / dependency-direction inference (`detectLayerBoundaries`). Archprint now infers a repo's layers
from its directory structure and, for each interacting layer pair, the observed dependency direction, then
flags the minority ("upward") direction as a candidate forbidden boundary through the same Wilson confidence
gate used for the other rules. The scan is fast (specifier-level) by default, with a deep type-resolved mode
available; both agree on the enforced (AUTO) boundaries. This is the first of the broader rule families that
bring Archprint level with hand-written architecture-conformance tools, with the difference that the rules
are inferred from the real import graph and evidence-gated rather than hand-written.
