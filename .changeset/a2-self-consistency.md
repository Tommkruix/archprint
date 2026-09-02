---
'archprint': minor
---

Add a self-consistency guardrail (roadmap A2). Before `generate` writes anything, it verifies every AUTO rule
it would emit is internally coherent: it governs a non-empty population, and the exception files its gate
recorded exactly match the violations it lists (and stay within the exception budget). If any rule fails,
generate refuses to write and names the rule, so a detector regression can never ship an incoherent rule. The
check is exported as `checkSelfConsistency` and covered by a test that both confirms real repos are clean and
that an injected inconsistency is caught.
