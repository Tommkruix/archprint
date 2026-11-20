---
'archprint': minor
---

The dead-code report has a third list, **shipped in a published package**: files nothing in the repo imports (or only tests import) that a published package ships without an `exports` map. A user of such a package can import any file it ships by path, such as `xstate/lib/model`, so these files are no longer listed as orphans or test-only; they are shown apart, neither dead nor known to be used. `scan --json` and the MCP scan tool list them under `deadCode.shipped`. A package counts as published when it is named, not private, has no `exports`, and has a `files` list, a `publishConfig` or an `.npmignore`; a file ships when the package packs the file or what a tsconfig that takes it in builds from it (read from its `files` list, `.npmignore` or `.gitignore` the way `npm pack` reads them), including a published package that compiles another package's sources.
