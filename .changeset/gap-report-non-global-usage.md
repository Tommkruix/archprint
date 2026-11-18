---
'archprint': patch
---

The gap report sends a `forbid-usage` mapping back to be checked when the code has its name only as something other
than a global, such as the JSX attribute `dangerouslySetInnerHTML`, the member `window.localStorage` or a local
variable, naming the files that have it. Before, such a rule was listed to enforce now and `generate --declare`
adopted it, although it could never report anything.
