# archprint

## 0.2.0

### Minor Changes

- 621dd8f: Add a self-consistency guardrail (roadmap A2). Before `generate` writes anything, it verifies every AUTO rule
  it would emit is internally coherent: it governs a non-empty population, and the exception files its gate
  recorded exactly match the violations it lists (and stay within the exception budget). If any rule fails,
  generate refuses to write and names the rule, so a detector regression can never ship an incoherent rule. The
  check is exported as `checkSelfConsistency` and covered by a test that both confirms real repos are clean and
  that an injected inconsistency is caught.
- b6cebc9: Separate rule applicability from role-classification confidence in the confidence gate (roadmap A4). The gate
  previously overloaded `roleConfidence`: detectors passed `0` both to mean "this rule governs nothing" (vacuous)
  and paid the price when a role was real but only moderately identifiable, so a genuinely-followed rule over a
  low-confidence role was silently REJECTed. The gate now takes an explicit `applicable` flag for the vacuous
  case, and grades role confidence in two tiers: `>= 0.8` to auto-enforce, `>= 0.5` (moderate) to suggest. A real
  but moderately-classified role (for example a UI component matched only by its `.tsx` extension) now surfaces as
  a SUGGEST instead of vanishing, while a role we are more-unsure-than-not about is still rejected. Consequently
  ui-data isolation, whose COMPONENT role is a 0.5-confidence catch-all, can no longer auto-enforce at the gate
  level (not merely by family tiering); it is review-only by construction. The four vacuous-guard detectors
  (ui-data, env-access, server-client, test-isolation) were migrated to the new `applicable` flag with no change
  to their deterministic-role outcomes.
- fccc369: `archprint scan` now discovers app directories automatically. Pointed at a repo root, including a monorepo,
  it finds each app or package that has its own tsconfig.json and enough of its own source, and scans each one,
  rather than requiring you to point at a single app directory. Sub-packages below the size threshold are
  skipped; single-app repos are unchanged.
- 4a36220: Add monorepo app isolation, a new rule family: sibling apps under an `apps`/`services` container must not
  import each other directly (they should communicate through shared packages). `detectAppIsolation` gates
  "apps under `<container>` must not import each other" with the Wilson floor, and `archprint generate` writes
  `dependency-cruiser.app-isolation.archprint.json`, a `$1`-back-reference cross-app rule. The sibling-isolation
  traversal and gating are now factored into a shared `detectSiblingIsolation` core used by both the
  feature-slice and app-isolation detectors.
- 864fff5: Add the CLI: `archprint scan | generate | explain | approve` (commander), wiring the full pipeline so a
  repo is scanned, its markers inferred, patterns gated, and rule artifacts emitted end to end.

  `scan` and `explain` are specifier-level by default (about a second on a few-thousand-file repo), with
  `--deep` to resolve imports through barrels and aliases. `generate` and `approve` resolve the graph by
  default (the commitment point should not mint an AUTO rule the full graph would reject), with a `--fast`
  opt-out that warns to confirm with a deep pass before enforcing.

  Internally, `detectForbiddenImports` runs several patterns in one shared pass, and `createImportAnalyzer`
  takes `{ resolve: false }` to skip module resolution and the type checker. The fast path matches only at
  the import-specifier level, so barrel/alias-hidden imports are not caught in that mode (disclosed in the
  fast-scan report footer); the emitted rule enforces at the specifier level regardless, which its rule card
  documents.

- 6f27c1a: Add circular-dependency detection (`detectCycles`). Archprint builds the first-party import graph for an app
  and finds every strongly connected component (Tarjan), reports the cycles, and gates a "no circular
  dependencies" rule by how cycle-free the repo already is. The graph is built fast (specifier-level) by
  default, with a deep type-resolved mode available; both agree on the cycles. A cycle-free repo yields an AUTO
  no-cycles rule; a cyclic one surfaces the cycles for review.
- 25040e3: Add import-style detection: prefer workspace aliases over deep relative imports (`../../../` and deeper).
  `detectDeepRelativeImports` gates the rule with the Wilson floor over files that use relative imports, and
  `archprint generate` writes `eslint.deep-relative.archprint.json`, an ESLint `no-restricted-imports` config,
  Archprint's first ESLint-core output format.
- 258777b: Add dependency hygiene, a new rule family covering external packages (the first detector that is not
  first-party only): a file should import a third-party package by its public entry or a documented subpath, not
  by reaching into its build/impl directories (`dist`, `src`, `lib`, `esm`, `cjs`, `build`, `out`, `internal`).
  `detectDependencyInternals` counts files importing external packages and those reaching into internals, gates
  with the Wilson floor, and `archprint generate` writes `dependency-cruiser.dependency-internals.archprint.json`.
- 8440ef3: Add the pattern detector and confidence gate: `detectForbiddenImport` / `detectNoDbInRequestEntry`
  infer a "role A must not import target B" boundary from the resolved import graph, and `evaluateGate`
  decides AUTO / SUGGEST / REJECT against four conditions (ratio >= 90%, evidence >= 20 files,
  exceptions <= 3, role confidence >= 80%). Markers match the import specifier and first-party leaves
  only (never a dependency's internal `node_modules` folders). The file walker now classifies `.ts`
  modules with a top-level `"use server"` directive as server actions.
- 5d4af81: The import analyzer now captures dynamic imports (`import('...')`) as value edges, resolving the target in
  deep mode (barrel-aware, like a namespace import) and by specifier in fast mode. Layer / dependency-direction
  and cycle detection now see dependencies that flow through dynamic imports; on real codebases this surfaces
  cycles and edges a static-only scan would miss.
- 629468e: `archprint generate` now emits the inferred layer / dependency-direction boundaries as a dependency-cruiser
  config (`dependency-cruiser.archprint.json`), one `forbidden` rule per AUTO boundary. This is the first of the
  ecosystem output formats: the rules Archprint infers can be enforced directly by dependency-cruiser in CI,
  rather than being hand-written.
- 5726159: `archprint generate` now also emits the inferred layer boundaries as an eslint-plugin-boundaries config
  (`eslint-boundaries.archprint.json`): each layer becomes an element type, and each layer disallows the layers
  it must not import. Alongside the dependency-cruiser output, the inferred rules can be enforced by whichever
  tool a TypeScript team already uses.
- e92d273: Add entry-point purity, a new rule family: framework file-convention entries (pages, routes, layouts, API
  handlers) are loaded by the framework and should not be imported by other first-party code. `detectEntryPurity`
  counts entries with a non-zero first-party in-degree and gates the rule with the Wilson floor; `archprint
generate` writes `dependency-cruiser.entry-purity.archprint.json`.
- 667de54: Make `archprint explain` actionable (roadmap B2). Each explanation now shows, below the gate breakdown, a
  codeframe for every exception (the offending import line with its line number), a "How to fix" line, a "When
  not to use this" caveat, and a "How to enforce" line that names the exact next command for the rule's gate
  status. Per-rule guidance lives in a single `rule-guidance` source and the codeframe reader is a small,
  self-contained module.
- b5598e4: Introduce family-maturity tiering so only audit-trusted rules auto-enforce. The Phase A1 adversarial audit
  found that every false-AUTO came from the structural-inference families (layer, role-layering, entry-purity,
  ui/data, server/client, feature-slice, app-isolation, stories, plus env-access and workspace-package-api),
  while the mechanical families had zero false-AUTO across 148 audited rules. `archprint generate` now emits only
  the mechanical families as AUTO by default and holds the structural families for review (pass
  `--include-structural` to emit them anyway); `archprint recommend` correspondingly lists structural AUTO under
  "review and adopt" rather than "enforce now". This makes the tool honest and shippable today: nothing whose
  inferred layer/role can be wrong is ever silently written as enforcement, while the structural families are
  hardened toward AUTO over time.
- 87ad55d: Add feature-slice isolation, a new rule family. A container directory (`features`, `modules`, `slices`,
  `domains`) holds sibling slices that should not import one another; `detectFeatureSliceIsolation` counts each
  slice file that imports a different sibling slice and runs it through the Wilson gate, so "slices under
  `<container>` must not import each other" becomes enforceable (AUTO), provisional (SUGGEST), or unsupported.
  Surfaced in the scan report, and `archprint generate` writes
  `dependency-cruiser.feature-slice.archprint.json`, a cross-slice `forbidden` rule that captures the source
  slice and forbids the others with a `$1` back-reference.
- 84b9da9: Broaden framework role coverage in the classifier so the existing rules apply beyond Next.js and NestJS:
  SvelteKit (`+server.ts` endpoints, `+page.server.ts`/`+layout.server.ts` server loads, `hooks.server.ts`,
  and `+page.ts`/`+layout.ts` universal loads), Nuxt Nitro handlers (`server/api|routes|middleware|plugins`),
  and Remix / React Router file-based routes (`app/routes/**`, `root`, `entry.server`/`entry.client`).

  `ROLE_PATTERNS` now maps each role to all of its path patterns rather than one, and the rule generator embeds
  every pattern per role. Previously a role matched by more than one rule would have collapsed to a single
  pattern in generated rules; with the new multi-framework rules this would have dropped variants.

- bbae98a: Grandfather known exceptions in the generated AP- eslint rules (roadmap B3). An AUTO rule is inferred because the
  code already follows it apart from at most a few exception files; the generated plugin rule now skips exactly
  those files, so wiring the rule and running the linter is green on the current codebase (no red wall on day one)
  while any new violation elsewhere is still caught, the standard ratchet. The exceptions remain visible in `scan`
  and `explain`; only enforcement grandfathers them. Proven end-to-end: the exception file passes and the same
  violation in a new file is flagged by the real eslint engine.
- 293be92: Emit the inferred layer dependency graph as Mermaid and Graphviz DOT (the visualization formats
  dependency-cruiser and madge produce). `archprint generate` now also writes `layer-graph.archprint.mmd` and
  `layer-graph.archprint.dot` whenever layers are present. Each interacting layer pair renders as a weighted
  directed edge: the dominant dependency is a solid arrow, and a leak that runs against an inferred boundary is
  dotted (Mermaid) or dashed red (DOT), so a reader sees the architecture and where it is violated.
- 0671bf9: Add `archprint init` (roadmap B1): a single zero-config onboarding command. It detects the repo's stack, scans
  the import graph, writes enforcement configs for the rules the code already follows (mechanical families by
  default, `--include-structural` to add the review-tier families), and records an `archprint.json` manifest with
  the three census-backed recommendation tiers (enforce now / review / adopt) so the setup is reproducible and
  inspectable. It refuses to overwrite an existing manifest without `--force`, runs the self-consistency guardrail
  before writing, and prints a friendly summary with next steps. The writer orchestration shared with `generate`
  was extracted into a single `writeEnforcementConfigs` helper so the mechanical/structural partition lives in one
  place.
- f4943d8: Add machine-readable output (roadmap B4). `scan --json` emits a stable, serializable summary (per app: file and
  alias counts, plus each non-rejected rule with its family, status, observed conformance, confidence floor,
  observations, and violating-file count), and `recommend --json` emits the three recommendation tiers as JSON.
  Both are keyed by `archprintVersion` for forward compatibility, making archprint scriptable in CI. Exit codes are
  the documented contract: 0 on success, 1 on error or refusal. SARIF is intentionally left to the tools archprint
  emits into (eslint and dependency-cruiser already produce it) rather than reimplemented here.
- fccc369: Add layer / dependency-direction inference (`detectLayerBoundaries`). Archprint now infers a repo's layers
  from its directory structure and, for each interacting layer pair, the observed dependency direction, then
  flags the minority ("upward") direction as a candidate forbidden boundary through the same Wilson confidence
  gate used for the other rules. The scan is fast (specifier-level) by default, with a deep type-resolved mode
  available; both agree on the enforced (AUTO) boundaries. This is the first of the broader rule families that
  bring Archprint level with hand-written architecture-conformance tools, with the difference that the rules
  are inferred from the real import graph and evidence-gated rather than hand-written.
- 0f41d6f: Add the generated-output lifecycle (roadmap B6, part 1). Archprint now records everything it writes into an
  `.archprint-outputs.json` manifest in the output directory, so it owns a precise, safe list of its own files.
  `generate` and `init` now clean their previous outputs before writing fresh ones, so a rule the evidence no
  longer supports stops being enforced instead of lingering as a stale file (upholds the conservative-bias
  principle). A new `archprint eject` command removes archprint's generated files and its config manifests cleanly
  (`--dry-run` to preview), giving a clean uninstall. The clean step only ever touches paths archprint recorded
  as its own, and refuses to delete anything outside the output directory.
- 38789b8: Make the flagship forbidden-import rules (AP-) loadable and enforceable (roadmap B7). `generate`/`init` now emit
  a self-contained local eslint plugin (`eslint-plugin.archprint.mjs`) that implements each AUTO forbidden-import
  rule faithfully to the detector (matches the import specifier, skips type-only imports, and only applies to files
  whose path matches the rule's role). The eslint aggregator loads the plugin so a single wired reference activates
  the rules, and they are removed cleanly on `eject`. An end-to-end test runs the real eslint engine and confirms a
  server-entry route importing the UI layer is flagged while a clean route passes. Also fixes a wiring bug where a
  single-line `export default []` config had its array closer swallowed by the inserted managed comment.
- 1faa4aa: Infer forbidden-import markers per repo instead of using one repo's hardcoded conventions.
  `inferUiLayerMarkers` derives the UI-layer specifier from where a repo's components cluster,
  disambiguated by import fan-in so a shared component library beats a feature directory.
  `inferDbClientMarkers` combines a curated list of known db libraries with first-party wrappers
  discovered by client instantiation (unambiguous ORM constructors, or generic pool/driver
  constructors paired with a known-library import), and emits a leaf-path marker per wrapper so
  barrel re-exports are caught via the detector's barrel resolution. `detectUiLayerInServerEntry` and
  `detectDbClientInRequestEntry` use them, and `DEFAULT_DB_MARKERS` drops its repo-specific first-party
  entries.

  This reduces hardcoding of first-party conventions; it does not eliminate hardcoding: the known-db
  library list, the ORM constructor set, and the structural-segment exclusions are curated framework/ORM
  vocabulary by design. Inference is heuristic: an exotic ORM whose constructor is not listed is missed,
  and UI fan-in only helps when the shared layer is actually imported, so a fully colocated app whose
  routes never import the shared library can still pick a feature directory.

- 0fbca1c: Merge `approve` into `generate --rule <id>`. Emitting a single reviewed rule (including a SUGGEST rule) was a
  special case of generate, and having two commands that both write rule artifacts was the one genuinely ambiguous
  pair in the CLI. Now `archprint generate --rule AP-001` does what `archprint approve AP-001` did; the standalone
  `approve` command is removed. Naming the rule is the explicit consent, so the AUTO-is-automatic /
  SUGGEST-needs-review distinction is preserved. This drops the command surface from 8 to 7. Done pre-1.0, before
  the surface is public.
- 2e7d4bc: Add orphan-module detection: `detectOrphans` finds first-party source files that no other file imports and
  that are not framework or tooling entry points (routes, pages, layouts, middleware, config). These dead-code
  candidates are surfaced in the scan report as an informational SUGGEST (never enforced), since dynamic or
  string-based loading can make a live file look unreferenced. The cycle and orphan detectors now share a
  single `buildImportGraph` builder so the first-party value-import graph is constructed one way.
- 5b57f3c: Add phantom-dependency detection: every imported third-party package should be declared in package.json rather
  than relied on transitively. `detectPhantomDependencies` collects the declared dependencies (the app's
  package.json, the workspace root's, and all workspace package names) and flags imports of anything else, gated
  by the Wilson floor. `archprint generate` writes `dependency-cruiser.phantom-deps.archprint.json` keyed on
  dependency-cruiser's `npm-no-pkg` / `npm-unknown` dependency types.
- e94ac18: Add public-API (barrel) boundary detection. A directory holding an `index.ts`/`index.tsx` exposes a public
  API; `detectPublicApiBoundaries` classifies every external consumer against the nearest enclosing barrel (an
  import of the barrel conforms, an import of any other file in the group is a deep-import violation) and runs
  the count through the Wilson gate, so "files outside `<dir>` must import it through its barrel" becomes
  enforceable (AUTO), provisional (SUGGEST), or unsupported. Surfaced in the scan report. Uses the fast import
  graph deliberately: deep resolution would resolve through the barrel and erase the barrel-vs-deep signal.
- 7d6a325: Generate an enforceable rule from public-API boundaries. `archprint generate` now writes
  `dependency-cruiser.public-api.archprint.json`: one `forbidden` deep-import rule per AUTO barrel group, where
  a module outside `<dir>` may not import any file inside it except the barrel. Completes the public-API rule
  family (detect plus emit), alongside the existing dependency-cruiser and eslint-plugin-boundaries layer
  outputs.
- d25caf9: Back `archprint recommend` with real adoption evidence. The command now ships a catalog of per-family
  AUTO-adoption rates, overall and per detected stack, mined from a 92,861-repo census, and attaches to every
  recommendation the share of comparable repos that already enforce that rule. The "adopt from day one" tier is
  now decided by that census evidence (a family is recommended when a meaningful share of comparable repos
  already enforce it) instead of hand-picked stack flags, so the guidance reflects what the TypeScript ecosystem
  actually does.
- dcc2b66: Add `archprint recommend`, which sorts every rule family into three tiers from the repo's
  evidence and detected stack: enforce now (already followed), review and adopt (thin evidence),
  and adopt from day one (suits the stack but not yet evidenced). The last tier gives fresh repos a
  stack-aware baseline to enforce from day one, where there is little code to infer from.
- 803839d: Add role-based layering, a new rule family that uses the classifier's semantic roles rather than directory
  names, so it catches the classic backend tier hierarchy even when the tiers are named suffixes rather than
  folders (NestJS-style). `detectRoleLayering` counts value edges between roles (CONTROLLER, SERVICE, REPOSITORY,
  DATA_ACCESS, DB_MODULE), takes the minority direction of each interacting pair as the candidate boundary, and
  gates it with the Wilson floor (using the classifier's confidence as roleConfidence). `archprint generate`
  writes `dependency-cruiser.role-layering.archprint.json`.
- ded3544: Add the rule generator: from an AUTO-gated detected pattern, emit four artifacts (ESLint rule `.ts`,
  rule card `.md` with the evidence attached, plus passing and failing fixtures). The emitted rule is
  self-contained plain ESLint (no `@typescript-eslint` runtime dependency) and enforces the detector's
  direct-import semantics. Validated by RuleTester and an independent scratch-project run.
- 2d372bd: Add the scanner core: a workspace tsconfig alias resolver, a convention-based role classifier, a
  barrel resolver, and a symbol-level, type-aware, workspace-package-aware import analyzer
  (`analyzeImports`). This is the deterministic substrate the rule generator builds on.
- 0751a34: Fix two scanning bugs found by running archprint on itself. (1) Respect `.gitignore`: the walker and app-dir
  discovery now skip git-ignored paths (via the standard `ignore` matcher) in addition to the always-noise
  directories, so a scan no longer descends into vendored repos or other large ignored trees and hang. (2) Resolve
  ESM `.js` specifiers to their `.ts` source: `import './x.js'` where the file is `x.ts` (the NodeNext/ESM
  convention, which archprint's own code uses) now resolves, so first-party edges are found on ESM TypeScript
  projects instead of every file looking like an orphan. The three duplicated import resolvers were unified into
  one `resolveFirstPartyImport`. Verified against the five-repo regression corpus (unchanged) and by dogfooding
  this repo (false orphans dropped from 66 to 1, the real CLI entry).
- 6e758fa: Add the server/client boundary rule family (the twentieth detector): a Next.js `"use client"` module must not
  import a `server-only` module. `detectServerClientBoundary` finds `"use client"` modules (via a ReDoS-safe
  leading-directive scan) and modules importing the `server-only` package, then flags client modules that reach a
  server-only module, gated by the Wilson floor. `archprint generate` writes
  `dependency-cruiser.server-client.archprint.json`. The directive scanner is generalized to expose both
  `hasUseServerDirective` and `hasUseClientDirective`.
- 949d583: Add stories isolation: Storybook `.stories` files are loaded by Storybook and should not be imported by other
  code. `detectStoriesIsolation` flags stories with a non-story importer (over the shared import graph), gated by
  the Wilson floor, and `archprint generate` writes `dependency-cruiser.stories-isolation.archprint.json`.
- 3408ba6: Add test isolation, a new rule family: production (non-test) code must not import test or spec files.
  `detectTestIsolation` builds the import graph with test files kept as nodes (via a new `includeTests` option on
  `buildImportGraph`), counts production files that import a test file, and runs the count through the Wilson
  gate. Surfaced in the scan report (only when the app has test files), and `archprint generate` writes
  `dependency-cruiser.test-isolation.archprint.json`, a `not-to-test` `forbidden` rule.
- d28f41a: Add transitive layer reachability. `computeLayerReachability` condenses the first-party import graph by
  strongly-connected component into a DAG and computes, for every layer, the set of layers a file in it can
  reach through a chain of value imports. The scan now flags an AUTO layer boundary that a plain import rule
  would pass but that still leaks through an intermediary layer (`from` reaches `to` transitively), pointing at
  the stronger dependency-cruiser `reachable` form. The cycle, orphan, and reachability passes now share one
  prebuilt import graph and one strongly-connected-components routine, so a full scan builds the graph once.
- ea29d9c: Add UI/data separation: reusable UI components (COMPONENT role) should reach the data layer through services,
  not import the DB/data layer (`DB_MODULE` / `DATA_ACCESS`) directly. `detectUiDataIsolation` gates it with the
  Wilson floor over the component population, and `archprint generate` writes
  `dependency-cruiser.ui-data.archprint.json`.
- 628c96e: Add two AST usage-based rule families over a new shared usage-scanner: console isolation (library / non-CLI
  code must not call `console.*`) and env access (read `process.env` only in the config/env layer). Both are
  Wilson-gated and emit scoped ESLint flat-config blocks (`no-console`, `no-restricted-properties`) via
  `archprint generate`. This is Archprint's first analysis beyond the import graph.
- 756c800: Gate rules on a statistical confidence bound instead of a fixed file-count threshold.

  The confidence gate previously required `ratio >= 90%` AND `evidence >= 20` files as two separate checks.
  These are now fused into one principled test: the Wilson score 95% lower bound on the true conformance rate
  must be at least 90%. This accounts for sample size and observed rate together, a pattern followed in 5/5
  files is not evidence of a real rule (low bound), while 40/40 or 216/217 is. A pattern that looks like a
  rule (observed >= 80%) but lacks the evidence to be confident is now surfaced as a provisional `SUGGEST`
  rather than a silent `REJECT`, so a thin or simple codebase is not locked out. The `exceptions <= 3` and
  `roleConfidence >= 0.80` guards are unchanged. `GATE_THRESHOLDS` now exposes `{ confidence, exceptions,
roleConfidence }`.

- d39460b: `wire` now edits the common `export default tseslint.config(...)` and `export default defineConfig([...])`
  flat-config shapes, not just a bare `export default [` array (dogfood finding). It inserts the managed spread as
  the first config, keeping the file's formatting, and `eject` restores it exactly. Config shapes it still cannot
  parse fall back to the printed snippet as before. Proven end-to-end: wiring archprint's own `tseslint.config()`
  eslint config and running the real eslint engine fires the generated `no-console` rule.
- 1ddb697: Add `archprint wire` to reference the generated eslint rules from your flat eslint config (roadmap B6, part 2).
  `generate`/`init` now also emit an aggregator (`eslint.archprint.mjs`) that globs archprint's eslint rule blocks,
  so the reference is one stable line that survives regeneration (new rules are picked up, dropped ones disappear,
  without re-wiring). `wire` inserts a MANAGED, reversible block (a marked import + one spread) into a flat
  `eslint.config.{js,mjs,cjs}` when it can detect the array-form export, is idempotent, supports `--dry-run`, and
  prints the exact snippet to paste for any other shape. `eject` now also removes that managed reference, restoring
  the config exactly. Scope note: this wires the eslint built-in-rule blocks; the layer rules (eslint-plugin-
  boundaries), the AP- custom rules, and the dependency-cruiser configs still target their own tools.
- 23fba83: Generalize `wire`/`eject` across the enforcement tools a repo uses, not just eslint. Wiring is now a tool
  registry: `wire` detects each supported tool's config and inserts a managed, reversible reference into every one
  it finds, and `eject` removes them all. Dependency-cruiser is now supported: `generate`/`init` emit an aggregated
  `dependency-cruiser.all.archprint.json` (merging the individual forbidden-rule sets, refreshed on every
  regeneration), and `wire` adds a managed `extends` to a `.dependency-cruiser.json`, preserving the rest of the
  config and removing exactly that entry on eject. A tool config that cannot be edited safely (a JS
  dependency-cruiser config) gets the exact snippet printed instead. Adding a future tool is now a single registry
  entry.
- e4c7307: Add workspace-package public-API detection: in a monorepo, a workspace package should be imported by its name
  (which resolves to its entry), not by a deep path into its source. `detectWorkspacePackageApi` matches import
  specifiers against the workspace package names, gates deep imports with the Wilson floor, and `archprint
generate` writes `eslint.workspace-package.archprint.json` (a `no-restricted-imports` rule over the package
  names).

### Patch Changes

- 6188b91: Fix `detectLayerBoundaries` and `detectCycles` returning empty or incorrect results when called with a
  relative `appDir`. They now normalize the directory to an absolute path, so import edges resolve consistently
  whether an absolute or relative directory is passed. (The CLI already passed absolute paths and was
  unaffected.)
- bd70f41: Identify UI components by rendered JSX, not the `.tsx` extension.

  A component is now recognized when it actually renders JSX (a JSX element/fragment, or a
  `React.createElement`/`cloneElement` call), matching how react-docgen and eslint-plugin-react define a
  component, instead of trusting the `.tsx` file extension. A non-rendering `.tsx` file (types, constants,
  re-exports) no longer inflates a directory's component count, and a `.ts` file that renders via
  `createElement` is correctly counted. Detection uses a syntactic parse only (no type checker), so it stays
  fast. No marker change on inbox-zero, dub, formbricks, or cal.com.

- 96fb249: Detector accuracy fixes:

  - Type-only imports (`import type { X } from '...'` and inline `import { type X } from '...'`) are no longer
    counted as a runtime dependency on a forbidden target. They are erased at compile time, so a request entry
    that imports a marker only as a type is no longer a false violation, including in fast (specifier-only)
    mode. Implemented as a syntactic `hasValueBinding` signal on every analyzed import.
  - Database-client marker inference now recognizes first-party files that re-export a known database library
    (`export * from '@prisma/client'`, for example `@/lib/db` or a workspace-scoped
    `@scope/core/prisma-client`), not only files that instantiate a client. This closes a false-AUTO gap where
    direct database access through a re-export surface was invisible.

- 4d2a0fc: Speed up fast-mode scanning about 2.6x (roadmap C1/C2). Fast mode now extracts imports with the raw TypeScript
  parser instead of ts-morph's heavier wrapper layer (same AST fidelity, no regex parsing), and caches each file's
  parse by path + mtime + size so the many detectors that scan the same files reuse one parse instead of
  re-parsing. On inbox-zero (2,232 files) a fast scan drops from ~13.5s to ~5.2s. Output is unchanged: the
  per-family gate distribution is identical across the five-repo regression corpus, and all tests pass. Deep mode
  (full barrel/alias resolution via ts-morph) is unaffected.
- fcd8010: Fix four more Phase A1 re-audit findings in the structural families: server-client is REJECTed as vacuous when
  no `server-only` module exists anywhere; `.e2e-spec` files and `__tests__`/`test`/`e2e`/`cypress`/`playwright`
  directories are classified as tests (so test scaffolding no longer forms bogus layers); generated code
  (`generated/**`) is neutral so a component importing generated enums is not a false data-layer violation; and
  an entry re-exporting another entry (idiomatic route aliasing) no longer breaks entry-purity.
- f70c105: Fix four correctness bugs the Phase A1 audit found in the structural detectors, all of which produced
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

- 9ab170d: Resolve bare `baseUrl`-relative imports as first-party. With an explicit tsconfig `baseUrl`, TypeScript
  resolves a bare specifier like `import x from "app/foo"` or `"test/fixtures/x"` against baseUrl before
  node_modules, but the resolver treated these as external and dropped them, undercounting real violations (a
  false-AUTO source) and misreporting them as phantom dependencies. Each top-level directory under an explicit
  baseUrl is now a first-party prefix. Surfaced by the Phase A1 re-audit on three monorepos.
- 596df8f: Fix the env-access detector's confidence gate, which could never reach AUTO. It gated on the count of files
  that read `process.env`, but a repo that centralizes env access reads it in only a handful of config files, so
  the population was always far below the Wilson floor. It now gates on the non-config files the rule governs
  (the population), with violations being non-config files that read `process.env` directly, mirroring the
  console-isolation detector. A full 92,861-repo census surfaced the bug: env-access was AUTO on 0% of apps.
- 1266ebd: Fix the layer detector treating file-router route directories as architectural layers. `layerOfPath` skipped
  `app`/`pages` and promoted the first route segment beneath them to a "layer", so a file deep in
  `app/(group)/sub.domain/(group)/<segment>/` became layer `<segment>`, and same-named route directories across
  disjoint route groups collapsed into one fake, non-cohesive layer (e.g. a "programs" layer spanning nine
  unrelated `app/**/programs` directories). This produced many false "enforceable" rules on Next.js app-router
  repos. The router tree is now a single layer (`app`/`pages`), so only genuine top-level source directories
  become layers. Surfaced by the Phase A1 false-AUTO audit; on the audited repos this removed 131 of 222 layer
  AUTO rules, nearly all of them false positives, while preserving the real "shared layer must not import the
  router" boundaries.
- 3740ff8: Make the test-isolation gate REJECT when an app has no test files at all, instead of vacuously passing as
  AUTO. `generate`/`recommend` already suppressed this case at the surface, but the detector's own gate now
  reports it honestly, so every consumer of the gate status is consistent. Surfaced by the Phase A1 round-3 audit.
- 3cc1b6b: Make the scan report label consistent with what actually ships. The structural-inference families (layer,
  role-layering, entry-purity, ui/data, server/client, feature-slice, app-isolation, env-access,
  workspace-package, stories) now render as "(review before enforcing)" instead of "(enforceable)", matching the
  fact that `generate` holds them for review by default; the mechanical families keep "(enforceable)".
- 96e3ae4: Stop test files diluting UI-layer inference, and select the UI layer by coverage.

  Colocated test files were counted as counter-evidence against a component directory, sinking a real UI
  layer below the confidence gate (a false negative on repos that colocate tests next to components).
  Inference now excludes tests and stories from the file set, and selects the UI layer by component coverage
  (where components concentrate) instead of import fan-in, which mis-selected heavily-imported primitive
  sub-libraries such as `components/ui`. Validated with no marker change on inbox-zero, dub, formbricks, and
  cal.com.

- 0f5617d: Fix catastrophic backtracking (ReDoS) in the "use server" directive check.

  `hasUseServerDirective` used a regex with nested quantifiers over overlapping whitespace/comments, which
  backtracks exponentially: a file whose first bytes contain ~20+ comment tokens took ~6s, and more hung the
  scan indefinitely (a real hang on `archprint scan` for repos with heavily-commented or generated leading
  files). It now scans the head linearly (skipping whitespace, line comments, and block comments) with only a
  fixed-literal final check, so the worst case is linear. Behavior is unchanged for real inputs; a
  comment-heavy head that took seconds now takes microseconds.

- f2d0572: Classify Next.js App Router entry files as route entries, not reusable components.

  `page.tsx`, `layout.tsx`, `template.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `default.tsx`, and
  `global-error.tsx` under `app/` render UI but are framework entry points, not part of the shared UI layer.
  Classifying them as a distinct `ROUTE_ENTRY` role keeps them out of the component count during UI-layer
  inference, so a page-heavy feature area is no longer mistaken for the UI layer. No marker change on
  inbox-zero, dub, formbricks, or cal.com.

- d706e63: `archprint scan` now surfaces circular-dependency detection: it lists the import cycles it finds, or, when
  the repo is cycle-free, reports that the "no circular dependencies" rule is enforceable. Cycle detection runs
  in fast mode (the structural graph is faithful without the type checker), so it does not slow a `--deep` scan.
- d94fa88: Classify `.tsx` route handlers and `pages/api` files as request entries. Route handlers can legitimately use
  JSX (for example `next/og` `ImageResponse` routes), and matching only `.ts` misclassified those as UI
  components, hiding request-entry boundary violations in them.

Release notes are generated by [Changesets](https://github.com/changesets/changesets) on each release and
appear here starting with the first published version.
