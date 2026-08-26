---
'archprint': minor
---

The import analyzer now captures dynamic imports (`import('...')`) as value edges, resolving the target in
deep mode (barrel-aware, like a namespace import) and by specifier in fast mode. Layer / dependency-direction
and cycle detection now see dependencies that flow through dynamic imports; on real codebases this surfaces
cycles and edges a static-only scan would miss.
