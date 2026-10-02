---
'archprint': patch
---

The MCP server is ready for MCP directories. Each tool now has a human-readable title and is marked read-only and non-destructive, so clients can show it as safe to run (the remote `--http` tools are also marked as reaching the internet). The package declares its MCP Registry name, and every release publishes to the official MCP Registry automatically. `archprint scan` now labels each rule group the same way `init` and `recommend` do: dependency hygiene and dependency declaration read "review before enforcing", and circular dependencies read "report only". The README lists example prompts to ask your agent.
