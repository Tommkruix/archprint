---
'archprint': minor
---

Add the server/client boundary rule family (the twentieth detector): a Next.js `"use client"` module must not
import a `server-only` module. `detectServerClientBoundary` finds `"use client"` modules (via a ReDoS-safe
leading-directive scan) and modules importing the `server-only` package, then flags client modules that reach a
server-only module, gated by the Wilson floor. `archprint generate` writes
`dependency-cruiser.server-client.archprint.json`. The directive scanner is generalized to expose both
`hasUseServerDirective` and `hasUseClientDirective`.
