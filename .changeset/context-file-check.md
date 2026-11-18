---
'archprint': minor
---

`archprint check` now keeps up with your context files. When a pull request edits a CLAUDE.md, AGENTS.md, GEMINI.md, `.cursor/rules` file or `.github/copilot-instructions.md` that applies to the checked app, `check` lists the sentences it adds that no adopted rule enforces yet, and marks the ones that read like rules on their line (a notice on GitHub, ten at most), so a rule written down after your team ran the gap report does not stay guidance unnoticed. It also warns when a change removes the sentence behind a rule adopted with `generate --declare`; before, only `generate` said so. These notes never fail the check, and the JSON output and the MCP `archprint_check` tool return them under `context`.
