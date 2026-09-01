---
'archprint': patch
---

Fix the layer detector treating file-router route directories as architectural layers. `layerOfPath` skipped
`app`/`pages` and promoted the first route segment beneath them to a "layer", so a file deep in
`app/(group)/sub.domain/(group)/<segment>/` became layer `<segment>`, and same-named route directories across
disjoint route groups collapsed into one fake, non-cohesive layer (e.g. a "programs" layer spanning nine
unrelated `app/**/programs` directories). This produced many false "enforceable" rules on Next.js app-router
repos. The router tree is now a single layer (`app`/`pages`), so only genuine top-level source directories
become layers. Surfaced by the Phase A1 false-AUTO audit; on the audited repos this removed 131 of 222 layer
AUTO rules, nearly all of them false positives, while preserving the real "shared layer must not import the
router" boundaries.
