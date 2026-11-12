---
'archprint': patch
---

`scan` now counts references to a file from anywhere in its workspace, not only from inside the scanned app. A file another package imports (`@acme/ui/button` from `apps/web`), or that a nested app imports through its own tsconfig alias (`@/components/...` in a `landing/` folder with its own `tsconfig.json`), is no longer listed as an orphan, and `require()` calls count as references. Outside a workspace, the scanned folder is still the scope. Each import resolves through the nearest tsconfig of the file that makes it, the same way archprint's written rules resolve.
