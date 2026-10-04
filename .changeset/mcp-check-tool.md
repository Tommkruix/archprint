---
'archprint': minor
---

The MCP server has a fourth read-only tool, `archprint_check`. An agent can ask which of the repo's adopted rules its current change breaks, uncommitted edits included, and fix them before it finishes. It returns the same report as `archprint check --format json`, without the version field. That JSON now also names the `app` the file paths are relative to, which matters in a monorepo. `archprint_explain` now returns how to fix a violation and when not to adopt the rule for the database and UI rules, and its description says what it adds over `archprint_scan`. The recommendation for those rules is labelled "Forbidden imports (database client or UI in request handlers)".

`archprint check` no longer uses a git worktree for the base commit: it copies the base commit's files to a temporary folder with git's own plumbing, so it runs none of the repository's git hooks and writes nothing inside `.git`. A branch or commit name starting with `-` is refused.
