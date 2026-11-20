---
'archprint': patch
---

The dead-code lists no longer report a file imported with a bundler query, such as `import script from './load-theme?compiled-string'`, `./notes.ts?raw` or `./worker.js?worker&url`. The import now names the file without its query, as Vite and webpack resolve it.
