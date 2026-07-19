---
'archprint': minor
---

Infer forbidden-import markers per repo instead of using one repo's hardcoded conventions.
`inferUiLayerMarkers` derives the UI-layer specifier from where a repo's components cluster,
disambiguated by import fan-in so a shared component library beats a feature directory.
`inferDbClientMarkers` combines a curated list of known db libraries with first-party wrappers
discovered by client instantiation (unambiguous ORM constructors, or generic pool/driver
constructors paired with a known-library import), and emits a leaf-path marker per wrapper so
barrel re-exports are caught via the detector's barrel resolution. `detectUiLayerInServerEntry` and
`detectDbClientInRequestEntry` use them, and `DEFAULT_DB_MARKERS` drops its repo-specific first-party
entries.

This reduces hardcoding of first-party conventions; it does not eliminate hardcoding: the known-db
library list, the ORM constructor set, and the structural-segment exclusions are curated framework/ORM
vocabulary by design. Inference is heuristic: an exotic ORM whose constructor is not listed is missed,
and UI fan-in only helps when the shared layer is actually imported, so a fully colocated app whose
routes never import the shared library can still pick a feature directory.
