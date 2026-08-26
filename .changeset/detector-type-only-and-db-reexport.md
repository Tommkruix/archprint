---
'archprint': patch
---

Detector accuracy fixes:

- Type-only imports (`import type { X } from '...'` and inline `import { type X } from '...'`) are no longer
  counted as a runtime dependency on a forbidden target. They are erased at compile time, so a request entry
  that imports a marker only as a type is no longer a false violation, including in fast (specifier-only)
  mode. Implemented as a syntactic `hasValueBinding` signal on every analyzed import.
- Database-client marker inference now recognizes first-party files that re-export a known database library
  (`export * from '@prisma/client'`, for example `@/lib/db` or a workspace-scoped
  `@scope/core/prisma-client`), not only files that instantiate a client. This closes a false-AUTO gap where
  direct database access through a re-export surface was invisible.
