---
'archprint': minor
---

`archprint scan` reports far fewer false orphan modules, and lists the files only tests import separately. A file now counts as used when anything references it: a type-only import, an `export ... from` through a barrel, an `import()` call, or a tool config that names it (such as Vitest's `setupFiles`). Next.js metadata files (`robots`, `sitemap`, `manifest`, `opengraph-image`, `twitter-image`, `icon`, `apple-icon`), `proxy` and `instrumentation-client` at the app root, and Storybook stories are recognized as entries. Production files that only their own tests import, which is dead code the tests keep alive, now come first, under "Imported only by tests". On five open-source Next.js apps the orphan list shrank from 389 to 246 files without listing any file the earlier version did not. `detectOrphans` in the library API no longer takes an options argument, and its result adds `testOnly`.
