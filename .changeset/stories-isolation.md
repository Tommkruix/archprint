---
'archprint': minor
---

Add stories isolation: Storybook `.stories` files are loaded by Storybook and should not be imported by other
code. `detectStoriesIsolation` flags stories with a non-story importer (over the shared import graph), gated by
the Wilson floor, and `archprint generate` writes `dependency-cruiser.stories-isolation.archprint.json`.
