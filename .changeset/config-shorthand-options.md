---
'archprint': patch
---

A router option passed as a variable in shorthand, such as `tanstackRouter({ routesDirectory })` or Routify's `routify({ pages })`, is no longer read as absent: like any option archprint cannot read as text, it now stops archprint from guessing the folder. Before, the dead-code lists assumed the default folder (`src/routes`, `src/pages`) and could leave out real dead code there. In CommonJS files, a `join` or `resolve` taken with `const { join } = require('path')` now counts when a file loads a path it builds, as it already did for `import { join } from 'path'`.
