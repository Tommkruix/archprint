---
'archprint': minor
---

Introduce family-maturity tiering so only audit-trusted rules auto-enforce. The Phase A1 adversarial audit
found that every false-AUTO came from the structural-inference families (layer, role-layering, entry-purity,
ui/data, server/client, feature-slice, app-isolation, stories, plus env-access and workspace-package-api),
while the mechanical families had zero false-AUTO across 148 audited rules. `archprint generate` now emits only
the mechanical families as AUTO by default and holds the structural families for review (pass
`--include-structural` to emit them anyway); `archprint recommend` correspondingly lists structural AUTO under
"review and adopt" rather than "enforce now". This makes the tool honest and shippable today: nothing whose
inferred layer/role can be wrong is ever silently written as enforcement, while the structural families are
hardened toward AUTO over time.
