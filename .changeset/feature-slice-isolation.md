---
'archprint': minor
---

Add feature-slice isolation, a new rule family. A container directory (`features`, `modules`, `slices`,
`domains`) holds sibling slices that should not import one another; `detectFeatureSliceIsolation` counts each
slice file that imports a different sibling slice and runs it through the Wilson gate, so "slices under
`<container>` must not import each other" becomes enforceable (AUTO), provisional (SUGGEST), or unsupported.
Surfaced in the scan report, and `archprint generate` writes
`dependency-cruiser.feature-slice.archprint.json`, a cross-slice `forbidden` rule that captures the source
slice and forbids the others with a `$1` back-reference.
