---
'archprint': minor
---

Add `archprint mcp`, which runs archprint as an MCP server over stdio so Claude, Cursor, and other agents can inspect the architecture rules a repo already follows before they write code. It exposes three read-only tools, `archprint_scan` (the rules the repo follows, with evidence), `archprint_recommend` (what to enforce now, review, or adopt), and `archprint_explain` (the confidence-gate evidence behind one rule id), and never writes to the repo. Point any MCP client at `npx -y archprint mcp`.
