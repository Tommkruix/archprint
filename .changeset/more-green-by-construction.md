---
'archprint': patch
---

More fixes so an "enforce now" rule cannot flag code it was mined from:

- The dependency-cruiser test-isolation, phantom-deps, and no-internals rules now exclude test files
  (`__tests__`, `e2e`, `cypress`, `.test`/`.spec`/`e2e` suffixes), matching what the analysis excludes.
- no-internals matches only the internals directories the analysis measures (`src`, `internal`,
  `internals`), not a package's normal `dist`/`lib` entry.
- no-internals is now held for review (emitted with `--include-structural`) rather than auto-enforced,
  because its rule matches resolved paths and can flag a package whose own public entry resolves through
  `src/`.
- Phantom (undeclared) dependency checking is emitted only for dependency-cruiser; the ESLint form is
  dropped because it flags test files and first-party path aliases the analysis excludes.
- `wire` only splices into a recognized flat-config array or factory (`defineConfig`, `tseslint.config`);
  an unrecognized call such as `export default loadConfig()` bails instead of reporting a false success.
- `generate --check` reports files it could not parse instead of calling them clean.
