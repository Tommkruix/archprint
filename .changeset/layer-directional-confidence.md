---
'archprint': patch
---

More accurate layer-boundary inference. A layer boundary is now trusted for auto-enforcement only when the
evidence for its direction is strong (many imports consistently flow the dominant way). Boundaries inferred from
just a handful of cross-layer imports, where the direction could be noise, are held for review instead, which
removes spurious layer rules while keeping the well-evidenced ones.
