# Rule families

Every rule family Archprint can infer, what it detects, how it ships, and when not to use it. "Ships as" follows
the tiering explained in [concepts.md](./concepts.md#mechanical-vs-structural-families-what-auto-enforces):

- **Auto** — mechanical family; an AUTO result auto-generates as enforcement (0 false positives across the
  correctness audit).
- **Review** — structural-inference family; held for human review, emit with `--include-structural`.
- **Report** — surfaced only, never enforced.

Each generated rule ships with its evidence (conforming vs. total files, confidence floor) and grandfathers the
known exception files it was inferred from, so adopting it is green on your current code.

## Auto-enforced (mechanical) families

### Forbidden imports (AP-001 / AP-002) — Auto

Detects a request- or server-entry file importing a forbidden target: the database client directly (AP-001) or
the UI layer (AP-002). Markers (what counts as "the DB client" or "the UI layer") are inferred from your repo.
**When not to use:** small apps that deliberately keep data access inline with no service layer follow a
different but valid convention; AP-001 is treated as a case study (idiomatic direct-ORM is common), AP-002 is
the confirmatory rule.

### Circular dependencies — Auto

Detects runtime import cycles in the module graph; gated on how cycle-free the repo already is. Type-only edges
are excluded, so a cycle closed only by an `import type` is not flagged. **When not to use:** rarely, cycles are
a near-universal smell.

### Test isolation — Auto

Detects production (non-test) code importing a test or spec file. Vacuous on a package with no tests (rejected).
**When not to use:** if you keep shared setup helpers under a test directory and import them from production on
purpose, add an ignore for those files.

### Console isolation — Auto

Detects library (non-CLI) code calling `console.*`. Test files and cli/scripts/bin/tools paths are excluded,
and the emitted rule is scoped to exactly those measured files so wiring it stays green.
**When not to use:** if a package legitimately logs to the console as its purpose (a logger, a CLI you did not
place under those directories), scope or skip it.

### Import style (deep relatives) — Auto

Detects `../../../` deep relative imports where a workspace alias exists. A style preference, low risk.
**When not to use:** if your team prefers relative imports over aliases, skip it.

### Public API (barrels) — Auto

Detects a file outside a module deep-importing the module's internals, bypassing its `index` barrel. Only fires
when a barrel actually exists. **When not to use:** modules you intentionally expose without a barrel.

## Held for review families

These are held for review even at AUTO. The structural ones infer a layer or role from paths that can be
wrong; the dependency families are held because their enforcement matches resolved paths and can over-flag.
Emit any of them with `--include-structural` after reading the evidence.

### Dependency hygiene (no build/impl internals) — Review

Detects code reaching into a dependency's `/src/` or `/internal(s)/` rather than its public entry. Held for
review because the dependency-cruiser rule matches resolved paths, so it can flag a package whose own public
entry resolves through `src/`. **When not to use:** if a dependency documents a deep path (or its entry) under
`src` as public API.

### Dependency declaration (no phantom deps) — Review

Detects an imported third-party package that is not declared in `package.json` (a phantom/transitive
dependency). Resolves monorepo hoisting to the workspace root. Held for review because the dependency-cruiser
rule matches resolved dependency types, so a workspace package with no local `package.json` entry can surface
as phantom. **When not to use:** rarely; undeclared deps are a real fragility once the workspace edge cases are
reviewed.

### Layer boundaries — Review

Detects a low-level layer importing a high-level one (for example `utils` must not import `app`), inferred from
the dominant dependency direction. **When not to use:** when a directory is not actually a cohesive layer (a
`utils/` that mixes server logic and client glue), the inferred boundary can forbid legitimate imports, review
the direction before enforcing.

### Role layering — Review

Detects a semantic tier importing against its direction (for example `SERVICE` must not import `DATA_ACCESS`).
**When not to use:** when your role naming does not match the classifier's (a thin DB-wrapper named
`*.service.ts`), the inferred direction can be off.

### UI / data separation — Review

Detects a reusable UI component importing the DB/data layer directly. Components are recognized across React
(`.tsx`), Angular (`.component.ts`, `.directive.ts`), and Vue/Svelte single-file components. Because the
component role is still inferred from those conventions, this never auto-enforces, it is always a suggestion.
**When not to use:** a `.tsx` file that exports plain functions rather than a component may be miscounted.

### Entry purity — Review

Detects non-entry first-party code importing a framework entry (a page, route, or layout). Entry-to-entry
re-exports (legacy URL aliases) are allowed. **When not to use:** frameworks where importing an entry from
elsewhere is idiomatic.

### Server / client boundary — Review

Detects a `"use client"` module importing a `server-only` module. Vacuous when no `server-only` module exists
(rejected). **When not to use:** a type-only import missing the `type` keyword is counted as a value edge; a
defensible lint smell, but confirm it is a real runtime concern.

### Feature-slice isolation — Review

Detects sibling slices under a `features`/`modules`/`slices`/`domains` container importing each other.
**When not to use:** siblings that are not actually intended to be isolated.

### App isolation — Review

Detects sibling apps under an `apps`/`services` container importing each other directly. **When not to use:**
same peer-isolation ambiguity as feature-slice.

### Env access — Review

Detects non-config code reading `process.env` directly. Vacuous when nothing reads env (rejected). **When not to
use:** `NEXT_PUBLIC_*` variables read in UI code are idiomatic in Next.js (build-time inlined), not a smell.

### Workspace-package API — Review

Detects importing a workspace package by a deep path into its source rather than by its name. **When not to
use:** a build-config file consuming a shared preset by path when that is its only entry point.

### Stories isolation — Review

Detects app code importing a Storybook `.stories` file. Structural because story detection is a naming
heuristic. **When not to use:** rarely; low volume.

## Report-only families

### Orphans — Report

Files nothing imports and that are not framework entries (dead-code candidates). Reported only, never enforced,
too many files are legitimately unreferenced (entrypoints, side-effect modules, config).

### Reachability — Report

A layer boundary a plain import rule passes but that leaks through an intermediary layer. Surfaced as a note on
the affected layer rule; a transitive-reachability rule is not expressible in all emitted tools.
