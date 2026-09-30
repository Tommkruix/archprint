---
'archprint': minor
---

Add `archprint mcp --http`, a remote MCP server that scans a public repository by URL. It clones the repo shallow to a temp directory (public github.com, gitlab.com, or bitbucket.org only), runs the same read-only `scan`, `recommend`, and `explain` analysis, returns the result, and deletes the clone, so an agent can inspect a repo's architecture without anything being installed locally. The tools take a `repo` URL and an optional `ref`. The server is stateless and binds `0.0.0.0:8848/mcp` by default (`--host`/`--port`, or `$PORT`); put an authenticating, rate-limited proxy in front before exposing it publicly.
