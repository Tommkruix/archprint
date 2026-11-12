---
'archprint': patch
---

`scan` no longer lists a file a package exposes through its package.json as an orphan. A file named by `main`, `module`, `types`, `browser`, `bin` or an `exports` target (including `*` patterns and folder targets) is loaded by whoever installs or runs the package, so nothing in the repository needs to import it: a CLI behind `bin`, a VS Code extension's `main`, a library subpath. A target that points at build output counts for its source file: through the package's tsconfig `outDir` and `rootDir`, as knip maps it, or from `dist/`, `lib/`, `build/` or `out/` to `src/` when that source file exists.
