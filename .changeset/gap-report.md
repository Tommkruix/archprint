---
'archprint': minor
---

New `archprint gap-report` command and `archprint_gap_report` MCP tool check the architecture rules your CLAUDE.md or AGENTS.md already states against your code. Your agent maps each rule-like sentence to one of a few templates, quoting it: forbid an import (by path, package or named export), forbid a global such as `fetch` or `process.env`, allow no new files under a folder, or point at a rule archprint already finds. Archprint checks the quote is in the file and the mapping matches real files, then groups every sentence: enforce now, enforce with a baseline (the files and lines that break it today), already an archprint rule, check the mapping, or guidance only. Each mapping is restated in plain words next to the quote, so you can compare the two, and a rule nothing in the code breaks is marked as such. Archprint calls no model: every number is computed from your code. Nothing is written.
