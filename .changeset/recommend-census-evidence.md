---
'archprint': minor
---

Back `archprint recommend` with real adoption evidence. The command now ships a catalog of per-family
AUTO-adoption rates, overall and per detected stack, mined from a 92,861-repo census, and attaches to every
recommendation the share of comparable repos that already enforce that rule. The "adopt from day one" tier is
now decided by that census evidence (a family is recommended when a meaningful share of comparable repos
already enforce it) instead of hand-picked stack flags, so the guidance reflects what the TypeScript ecosystem
actually does.
