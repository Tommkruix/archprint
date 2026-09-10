---
'archprint': minor
---

`archprint generate` gains two output controls: `--emit <eslint|dependency-cruiser|all>` forces the
output format regardless of the tooling archprint detects, and `--no-graph` skips the layer dependency
graph (Mermaid and Graphviz).
