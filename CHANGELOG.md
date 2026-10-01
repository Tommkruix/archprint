# archprint

## 0.8.0

### Minor Changes

- The MCP tools and `scan --json` now say what each rule means and which files break it. Every rule carries a plain-language `statement` (the same wording `archprint scan` prints) and an `exceptions` list naming the files that break it (up to 10; `violatingFiles` still has the full count). `archprint_explain` now explains any rule from the scan by its label, such as `env-access` or `lib !-> app`, not only the `AP-` rules, and returns every exception file. An agent can now answer "what rules does this repo follow?" accurately from a single scan, instead of guessing what a family name means.

### Patch Changes

- `archprint init` now ends with the right next step. It names the config file it actually wrote (`.archprint/config.json`) and tells you to run `archprint wire` to reference the generated rules from your linter config, instead of describing an older file layout.
- The README and docs now open with a short recording of `archprint scan` and `archprint explain` on a real Next.js API, and link to a demo you can try in the browser on StackBlitz with nothing to install. The MCP section shows an MCP client calling `archprint_scan`.

## 0.7.1

### Patch Changes

- The remote MCP server now answers health checks at `/health` as well as `/healthz`. Cloud Run reserves `/healthz` and answers it before the request reaches the server, so use `/health` there.

  The docs now say plainly which server to use for what: the local stdio server (`archprint mcp`) is the one for private code, because it reads your local checkout and your source never leaves your machine; the remote HTTP server scans public repositories by URL, and since every request clones and scans, a hosted instance belongs behind authentication.

- Refresh the README so it describes the current release: the sample CLI output no longer shows an old version banner, and the wording about the `.archprint/` layout is stated as when it arrived rather than as the latest release, so it stays accurate in future versions.

## 0.7.0

### Minor Changes

- Add `archprint mcp --http`, a remote MCP server that scans a public repository by URL. It clones the repo shallow to a temp directory (public github.com, gitlab.com, or bitbucket.org only), runs the same read-only `scan`, `recommend`, and `explain` analysis, returns the result, and deletes the clone, so an agent can inspect a repo's architecture without anything being installed locally. The tools take a `repo` URL and an optional `ref`. The server is stateless and binds `0.0.0.0:8848/mcp` by default (`--host`/`--port`, or `$PORT`); put an authenticating, rate-limited proxy in front before exposing it publicly.
- Add `archprint mcp`, which runs archprint as an MCP server over stdio so Claude, Cursor, and other agents can inspect the architecture rules a repo already follows before they write code. It exposes three read-only tools, `archprint_scan` (the rules the repo follows, with evidence), `archprint_recommend` (what to enforce now, review, or adopt), and `archprint_explain` (the confidence-gate evidence behind one rule id), and never writes to the repo. Point any MCP client at `npx -y archprint mcp`.

### Patch Changes

- Make deep scans dramatically faster on real repositories by not loading `node_modules` into the analysis. Deep resolution now resolves first-party imports (including `baseUrl` and `paths`) and workspace packages, but skips pulling external dependencies into the TypeScript program, and caches module resolution. A single large app drops from about 5 minutes to under 20 seconds and a 14-app monorepo from over 30 minutes to about 2 minutes, with byte-identical results, so `generate` is now practical on large codebases.
- Scanning now skips everything git ignores, not just the root `.gitignore`: nested `.gitignore` files in subdirectories and repo-local `.git/info/exclude` are honored too. This keeps generated, vendored, and locally excluded directories out of the analysis, so a scan of a monorepo root is both faster and matches what you would expect git to track. Machine-global excludes are intentionally not read, so the same repository scans identically across machines.

## 0.6.0

### Minor Changes

- Archprint now writes a minimal `.archprint/` directory instead of a folder of per-family files. `generate` and `init` emit one self-contained rules file per linter you actually use (`.archprint/eslint.mjs` and/or `.archprint/dependency-cruiser.json`) plus a `.archprint/config.json` that records what is enforced and what Archprint manages. The plain-language summary that used to be `ADOPTION.md` is now a managed section in your `README.md`, and a managed `.prettierignore` entry keeps the generated files out of your formatter.

  - `--expand` writes the granular artifacts (per-family configs, per-rule cards and fixtures, the eslint-plugin, ts-arch tests, and the layer graph) inside `.archprint/` for anyone who wants to inspect or vendor individual rules.
  - New `archprint migrate` (alias `upgrade`) moves an older `archprint-rules/` setup to the new layout and rewrites the reference in your linter config in place, writing the new files before removing the old ones so the config never points at a deleted file. `generate` and `init` stop and point you to it if they detect the old layout.
  - `wire` imports the single rules file with an ESM-safe relative specifier, and `eject` removes the files, the config, the managed README section, and every wired reference.

## 0.5.0

### Minor Changes

- archprint now generates rules for the enforcers your repo actually uses. It detects whether you have
  ESLint or dependency-cruiser and emits each rule for a tool you already run, instead of writing
  dependency-cruiser configs you have no way to enforce. On an ESLint-only repo it expresses test
  isolation as an ESLint `no-restricted-imports` rule; dependency-cruiser configs are only written when
  dependency-cruiser is present. `archprint recommend` now names, per rule, the installed tool that will
  enforce it (or what you would need to install).
- `archprint generate --readme` writes an `ADOPTION.md` in the output directory summarizing what is
  enforced now, held for review, and worth adopting, each with the tool that enforces it. It is tracked
  in the manifest, so `archprint eject` removes it too.
- `archprint generate` gains two output controls: `--emit <eslint|dependency-cruiser|all>` forces the
  output format regardless of the tooling archprint detects, and `--no-graph` skips the layer dependency
  graph (Mermaid and Graphviz).
- `archprint generate` gains finer output control: `--only <family>` emits a single rule family,
  `--rules <ids>` emits only the named forbidden-import rule ids, and `--check` runs the generated
  ESLint rules against your repo and reports whether they pass, so you can confirm before wiring.

### Patch Changes

- Generated rules are now green-by-construction: a rule archprint says you "already follow" passes clean
  when you wire it, instead of flagging code that was there all along. Emitted rules are scoped to exactly
  the files the detector measured (test files and cli/config files are excluded, matching what the analysis
  skips) and exempt the specific exceptions the confidence gate accepted. This covers the console,
  environment-access, deep-relative-import, workspace-package, test-isolation, phantom-dependency, and
  dependency-internals rules across both ESLint and dependency-cruiser. The ESLint import rules
  (deep-relative, workspace, test) are also emitted as a single merged block so they no longer override one
  another in flat config.
- More fixes so an "enforce now" rule cannot flag code it was mined from:

  - The dependency-cruiser test-isolation, phantom-deps, no-internals, and public-API deep-import rules now
    exclude test files (`__tests__`, `e2e`, `cypress`, `.test`/`.spec`/`e2e` suffixes), matching what the
    analysis excludes.
  - The public-API deep-import rule also exempts the tolerated deep importers the confidence gate already
    accepted, so an "enforce now" rule cannot flag code it was mined from.
  - no-internals matches only the internals directories the analysis measures (`src`, `internal`,
    `internals`), not a package's normal `dist`/`lib` entry.
  - no-internals and phantom-deps are now held for review (emitted with `--include-structural`) rather than
    auto-enforced, because their rules match resolved paths or dependency types and can flag a package whose
    public entry resolves through `src/`, or a workspace package with no local `package.json` entry.
  - Phantom (undeclared) dependency checking is emitted only for dependency-cruiser; the ESLint form is
    dropped because it flags test files and first-party path aliases the analysis excludes.
  - `wire` only splices into a recognized flat-config array or factory (`defineConfig`, `tseslint.config`);
    an unrecognized call such as `export default loadConfig()` bails instead of reporting a false success.
  - `generate --check` reports files it could not parse instead of calling them clean.

- - `wire` parses your ESLint config with the TypeScript AST, so it reliably edits the common
    `const config = [...]; export default config;` shape and is not fooled by `export default` appearing
    inside a string or comment.
  - archprint no longer writes rule files for a tool your repo does not use; pass `--emit all` to force
    every format.
  - The wired ESLint config and the shareable preset ignore archprint's own generated files, so linting
    your repo never flags them.
  - `archprint generate --check` reports only violations of the rules archprint generated.
- `archprint wire` now edits the common config shape where the ESLint flat config is bound to a name
  and exported by reference (`const config = [...]; export default config;`, the default for Next.js and
  many TypeScript projects) instead of falling back to a manual edit. It resolves the exported name to
  its declaration, including a `defineConfig([...])` wrapper, and `archprint eject` reverses it as before.

## 0.4.1

### Patch Changes

- Scan repositories that declare a TypeScript project but have few source files. Archprint now recognizes
  `tsconfig.base.json` (not only `tsconfig.json`) and always scans a repo that has a tsconfig, instead of failing
  with a "no scannable app directory" error on TypeScript-light repos.

## 0.4.0

### Minor Changes

- Monorepo-friendly `recommend`, `generate`, and `init`. `recommend` now discovers every app directory under a
  monorepo root and reports per app (its `--json` output gains an `apps` array, matching `scan`). `generate` and
  `init` automatically use the single app directory they find under a root, or, when a monorepo has several, list
  the directories to point at instead of failing with a generic message.

### Patch Changes

- More accurate layer-boundary inference. A layer boundary is now trusted for auto-enforcement only when the
  evidence for its direction is strong (many imports consistently flow the dominant way). Boundaries inferred from
  just a handful of cross-layer imports, where the direction could be noise, are held for review instead, which
  removes spurious layer rules while keeping the well-evidenced ones.
- More accurate role-layering inference. A role boundary (for example, a repository must not import a service) is
  now trusted for auto-enforcement only when both the file roles are confidently classified and the direction is
  strongly evidenced. Boundaries whose direction rests on just a couple of imports, where it could be a coin flip,
  are held for review instead.

## 0.3.0

### Minor Changes

- Add Angular support: Archprint now detects Angular in your stack and recognizes Angular components, so the
  component-aware rules (such as UI/data separation) apply to Angular projects.
- Generate a shareable ESLint preset. `archprint generate` now writes a single, self-contained
  `eslint-preset.archprint.mjs` that inlines the inferred rules and needs only eslint, so you can commit it,
  publish it, or hand it to another repository and adopt the rules in one line:
  `import archprint from './eslint-preset.archprint.mjs'`.
- Scan Vue and Svelte single-file components. Archprint now reads the `<script>` block of `.vue` and `.svelte`
  files, treats them as UI components, and follows their imports, so the component-aware rules (such as UI/data
  separation) apply to Vue and Svelte projects.
- Emit architecture boundary tests for ts-arch. Alongside the ESLint and dependency-cruiser outputs, Archprint
  now writes a ts-arch test file for the inferred first-party boundaries (layer, role, and UI/data), so you can
  run them inside your existing Vitest or Jest suite.

## 0.2.0

First public release. Archprint mines the architecture rules your repository already follows from its real
import graph, gates each on statistical evidence, and emits them into the tools you already use.

### Highlights

- **Evidence-gated rule inference across 20 families**, including forbidden imports (DB client / UI in a server
  entry), import cycles, test isolation, console isolation, import style, public-API barrels, dependency hygiene
  and declaration, layer and role boundaries, UI/data separation, entry purity, server/client boundaries,
  feature-slice and app isolation, env access, workspace-package API, and stories isolation. Mechanical families
  auto-enforce; inferred structural families are held for review.
- **CLI**: `init` (zero-config setup), `scan` (the rules your code already follows, with the evidence),
  `recommend` (adoption tiers backed by a census of tens of thousands of public repositories, works on a fresh
  repo too), `explain` (per-rule evidence, codeframes, and how-to-fix), `generate` (write the rule configs), and
  `wire` / `eject` (reference the generated rules from your config, reversibly).
- **Emits into your stack**: ESLint, including a generated plugin for the forbidden-import rules, and
  dependency-cruiser, wired in with a single managed reference that survives regeneration.
- **Clean lifecycle**: re-running refreshes the output and drops any rule the evidence no longer supports; the
  few known exceptions are grandfathered so adoption is green on day one.
- **Framework awareness**: Next.js, Nest, SvelteKit, Nuxt, Remix, and React / Vue / Svelte stacks.
- **Machine-readable output** (`scan --json`, `recommend --json`) and stable exit codes for CI.
