---
'archprint': patch
---

The remote MCP server now answers health checks at `/health` as well as `/healthz`. Cloud Run reserves `/healthz` and answers it before the request reaches the server, so use `/health` there.

The docs now say plainly which server to use for what: the local stdio server (`archprint mcp`) is the one for private code, because it reads your local checkout and your source never leaves your machine; the remote HTTP server scans public repositories by URL, and since every request clones and scans, a hosted instance belongs behind authentication.
