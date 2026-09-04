# archprint

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
