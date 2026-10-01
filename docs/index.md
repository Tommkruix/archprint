---
layout: home
hero:
  name: Archprint
  text: The architecture rules your repo already follows
  tagline: Mined from the real import graph, gated on statistical evidence, emitted into the tools you already use.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Try it in your browser
      link: https://stackblitz.com/github/Tommkruix/archprint-demo
    - theme: alt
      text: Concepts
      link: /concepts
    - theme: alt
      text: Rules
      link: /rules
features:
  - title: Inferred, not authored
    details: Every other TypeScript architecture tool enforces rules you write by hand. Archprint infers candidates from your real import graph.
  - title: Evidence-gated
    details: Each candidate is measured against the code with a Wilson-score confidence gate. Mechanical families auto-enforce; structural ones are held for review.
  - title: Enforced where you already lint
    details: Emits a minimal .archprint/ directory, one self-contained file per linter you already use (ESLint and dependency-cruiser), wires into your config with a managed, reversible reference, and ejects cleanly.
  - title: Readable by your AI agent
    details: Run archprint as a read-only MCP server so Claude, Cursor, and other agents can read the repo's inferred rules and evidence as context before they write code. It reports; enforcement still lives in your linter.
---
