---
'archprint': patch
---

The documentation now states how precise the orphan list is: in a blind audit of 99 listed orphans from 66 open-source repositories, about half were in use (imported from another package, through an alias archprint does not resolve, from Vite's `index.html`, by a glob, a computed `import()`, a build config or file-based routing). Treat the list as candidates to check before deleting anything.
