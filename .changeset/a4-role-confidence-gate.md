---
'archprint': minor
---

Separate rule applicability from role-classification confidence in the confidence gate (roadmap A4). The gate
previously overloaded `roleConfidence`: detectors passed `0` both to mean "this rule governs nothing" (vacuous)
and paid the price when a role was real but only moderately identifiable, so a genuinely-followed rule over a
low-confidence role was silently REJECTed. The gate now takes an explicit `applicable` flag for the vacuous
case, and grades role confidence in two tiers: `>= 0.8` to auto-enforce, `>= 0.5` (moderate) to suggest. A real
but moderately-classified role (for example a UI component matched only by its `.tsx` extension) now surfaces as
a SUGGEST instead of vanishing, while a role we are more-unsure-than-not about is still rejected. Consequently
ui-data isolation, whose COMPONENT role is a 0.5-confidence catch-all, can no longer auto-enforce at the gate
level (not merely by family tiering); it is review-only by construction. The four vacuous-guard detectors
(ui-data, env-access, server-client, test-isolation) were migrated to the new `applicable` flag with no change
to their deterministic-role outcomes.
