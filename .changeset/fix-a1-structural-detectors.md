---
'archprint': patch
---

Fix four correctness bugs the Phase A1 audit found in the structural detectors, all of which produced
false "enforceable" rules:

- **Workspace self-reference imports** (`@scope/pkg/sub` where that is the app's own package name, an npm
  workspaces self-reference, not a tsconfig alias) are now resolved as first-party. They were silently
  dropped, undercounting violations (a false-AUTO source) and leaving a live enforcement gap.
- **Vacuous rules** no longer reach AUTO: UI/data-separation when the app has no data layer, and env-access
  when nothing reads `process.env` at all, govern nothing, so they can no longer be "enforceable".
- **Data-access classification** now recognizes a flat client file named after a known ORM
  (`utils/prisma.ts`, `lib/drizzle.ts`), not only files under a `db/`/`database/`/`prisma/` directory, so
  UI-imports-the-database violations are detected instead of a false "clean".
- **Dependency-hygiene** no longer flags a package's published `dist/lib/esm/cjs/build/out` subpaths as
  internal reaches (they are commonly the public entry point, e.g. `react-syntax-highlighter/dist/esm/...`);
  it flags only the unambiguous `/src/` and `/internal(s)/` reaches.
