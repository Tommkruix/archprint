---
'archprint': patch
---

Layer boundaries written for dependency-cruiser no longer fail on their first run. A rule such as `lib` must not import `app` used to flag the few existing exceptions it was generated with, test files, and type-only imports, none of which the scan counts. It also matched every folder with the layer's name at any depth, so a `lib/` folder inside a route like `app/(dashboard)/lib/` counted as the `lib` layer. The rule now matches only the folders the layer was found in, and in a monorepo it matches paths the way dependency-cruiser reports them from the folder where you ran archprint.

Layer boundaries are now found from imports as written in every scan mode, which is how dependency-cruiser, ESLint and ts-arch read them. A full scan used to follow re-exporting index files and could find a boundary its own rule then contradicted. Exceptions to other dependency-cruiser rules also match on a folder boundary now, so an exception for `lib/legacy.ts` no longer exempts `mylib/legacy.ts`.
