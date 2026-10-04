---
'archprint': patch
---

The local MCP server now says plainly when it is given a repository URL instead of a directory, and points to `archprint mcp --http` for scanning a public repository by URL. Before, it reported a missing `tsconfig.json` under a path built from the URL.
