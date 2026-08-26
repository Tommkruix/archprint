---
'archprint': minor
---

`archprint generate` now emits the inferred layer / dependency-direction boundaries as a dependency-cruiser
config (`dependency-cruiser.archprint.json`), one `forbidden` rule per AUTO boundary. This is the first of the
ecosystem output formats: the rules Archprint infers can be enforced directly by dependency-cruiser in CI,
rather than being hand-written.
