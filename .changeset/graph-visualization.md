---
'archprint': minor
---

Emit the inferred layer dependency graph as Mermaid and Graphviz DOT (the visualization formats
dependency-cruiser and madge produce). `archprint generate` now also writes `layer-graph.archprint.mmd` and
`layer-graph.archprint.dot` whenever layers are present. Each interacting layer pair renders as a weighted
directed edge: the dominant dependency is a solid arrow, and a leak that runs against an inferred boundary is
dotted (Mermaid) or dashed red (DOT), so a reader sees the architecture and where it is violated.
