---
'archprint': minor
---

Gate rules on a statistical confidence bound instead of a fixed file-count threshold.

The confidence gate previously required `ratio >= 90%` AND `evidence >= 20` files as two separate checks.
These are now fused into one principled test: the Wilson score 95% lower bound on the true conformance rate
must be at least 90%. This accounts for sample size and observed rate together, a pattern followed in 5/5
files is not evidence of a real rule (low bound), while 40/40 or 216/217 is. A pattern that looks like a
rule (observed >= 80%) but lacks the evidence to be confident is now surfaced as a provisional `SUGGEST`
rather than a silent `REJECT`, so a thin or simple codebase is not locked out. The `exceptions <= 3` and
`roleConfidence >= 0.80` guards are unchanged. `GATE_THRESHOLDS` now exposes `{ confidence, exceptions,
roleConfidence }`.
