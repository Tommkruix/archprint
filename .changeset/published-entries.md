---
'archprint': patch
---

The dead-code lists no longer report two kinds of files a package exposes. A package whose tsconfig writes its output into the package folder itself (`"outDir": "."` with `"rootDir": "src"`) now has its `main` and `exports` targets mapped to the source files they are built from. And each subpath a workspace package exports now counts as an import of `<name>/<subpath>`, resolved the way the repo resolves imports, so a tsconfig `paths` entry that maps `@scope/react/ListPlugin` to its source file marks that file as used.
