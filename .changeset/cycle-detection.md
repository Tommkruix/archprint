---
'archprint': minor
---

Add circular-dependency detection (`detectCycles`). Archprint builds the first-party import graph for an app
and finds every strongly connected component (Tarjan), reports the cycles, and gates a "no circular
dependencies" rule by how cycle-free the repo already is. The graph is built fast (specifier-level) by
default, with a deep type-resolved mode available; both agree on the cycles. A cycle-free repo yields an AUTO
no-cycles rule; a cyclic one surfaces the cycles for review.
