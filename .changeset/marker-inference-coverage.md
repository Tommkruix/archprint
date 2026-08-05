---
'archprint': patch
---

Stop test files diluting UI-layer inference, and select the UI layer by coverage.

Colocated test files were counted as counter-evidence against a component directory, sinking a real UI
layer below the confidence gate (a false negative on repos that colocate tests next to components).
Inference now excludes tests and stories from the file set, and selects the UI layer by component coverage
(where components concentrate) instead of import fan-in, which mis-selected heavily-imported primitive
sub-libraries such as `components/ui`. Validated with no marker change on inbox-zero, dub, formbricks, and
cal.com.
