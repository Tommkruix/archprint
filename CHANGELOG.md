# archprint

## 0.18.3

### Patch Changes

- Fix a crash on monorepos whose packages use a solution-style `tsconfig.json` (`"include": []` with `references`) that also sets `outDir`. `archprint scan` and the other orphan-reading commands stopped with "Cannot read properties of undefined (reading '0')"; such a config now counts as building nothing, and its referenced configs are read as before.
- `scan` no longer lists SvelteKit route files as orphans. In a SvelteKit project, the files SvelteKit loads from their default locations count as entries: `+page.svelte`, `+layout.svelte`, `+error.svelte` and the other `+` route files under `src/routes/` (layout resets such as `+page@.svelte` included), the hooks files, the param matchers (`src/params/*` in SvelteKit 2, `src/params` in SvelteKit 3), the service worker and `src/instrumentation.server`. Before, every route page nothing imported was reported as dead code. Other files in a route folder are still checked, and so is a `src/routes/` folder in a project without SvelteKit. archprint now also recognises a SvelteKit project without a `svelte.config`, such as every SvelteKit 3 project, by its Vite config importing `@sveltejs/kit/vite`: it gets `$lib` as `src/lib`, and its `$app/...` and `$env/...` imports no longer count as undeclared packages.

## 0.18.2

### Patch Changes

- archprint now resolves a tsconfig `paths` key whose `*` follows its prefix directly, such as `"@*": ["./src/*"]`, so `@components/button` is `src/components/button`. Imports written that way were unresolved before: the orphan list reported the files they import, and rules did not see those edges. Each folder and source file of the target becomes an alias, the way `baseUrl` folders already do; a key listed explicitly still wins, and a scoped package such as `@acme/ui` is unaffected unless a matching folder exists.
- `scan` now counts imports from JavaScript files (`.js`, `.jsx`, `.mjs`, `.cjs`), `.mts` and `.cts` files, and Astro components (the frontmatter and `<script>` blocks) when it lists orphan modules. A file that only one of these imports is no longer listed as an orphan, and one that only such a test imports (`*.test.js`, `*.test.mts`) is listed as test-only. These files are never listed themselves.
- `scan` no longer lists Next.js pages-router pages as orphans. A file under `pages/` or `src/pages/` of a project that declares `next` (in its package.json or its workspace root's) or has a `next.config.*` is a route Next.js loads by its path, so nothing needs to import it. Before, only `pages/api`, `_app`, `_document` and `index` files were recognised, and every other page nothing imported was reported as dead code. A `pages/` folder in an app without Next.js is still checked.
- The documentation now states how precise the orphan list is: in a blind audit of 99 listed orphans from 66 open-source repositories, about half were in use (imported from another package, through an alias archprint does not resolve, from Vite's `index.html`, by a glob, a computed `import()`, a build config or file-based routing). Treat the list as candidates to check before deleting anything.
- `scan` now counts references to a file from anywhere in its workspace, not only from inside the scanned app. A file another package imports (`@acme/ui/button` from `apps/web`), or that a nested app imports through its own tsconfig alias (`@/components/...` in a `landing/` folder with its own `tsconfig.json`), is no longer listed as an orphan, and `require()` calls count as references. Outside a workspace, the scanned folder is still the scope. Each import resolves through the nearest tsconfig of the file that makes it, the same way archprint's written rules resolve.
- `scan` no longer lists a file a package exposes through its package.json as an orphan. A file named by `main`, `module`, `types`, `browser`, `bin` or an `exports` target (including `*` patterns and folder targets) is loaded by whoever installs or runs the package, so nothing in the repository needs to import it: a CLI behind `bin`, a VS Code extension's `main`, a library subpath. A target that points at build output counts for its source file: through the package's tsconfig `outDir` and `rootDir`, as knip maps it, or from `dist/`, `lib/`, `build/` or `out/` to `src/` when that source file exists.
- `scan` no longer lists a file a package.json script runs as an orphan. When a script starts a JavaScript runtime (`node`, `tsx`, `ts-node`, `bun`, `deno` and similar, behind `npx`, `pnpm exec`, `cross-env` or environment variables), the file it runs and the modules or config its `--require`, `--import`, `--loader` or `--config` flags name are entries, as knip reads scripts; a built path such as `node dist/server.js` counts for its source file. Other tools' arguments, such as a lint or format glob, are not.
- archprint now resolves SvelteKit's `$lib` and `kit.alias` imports in a fresh checkout. SvelteKit defines them in a generated `.svelte-kit/tsconfig.json` that is not committed, so imports such as `$lib/server/counter` were unresolved: the orphan list reported the files they import, and rules did not see those edges. In a project that declares `@sveltejs/kit`, archprint reads `kit.files.lib` (`src/lib` by default) and the string entries of `kit.alias` from `svelte.config` without running it; an alias the tsconfig maps itself still wins. SvelteKit's own modules, `$app/...`, `$env/...` and `$service-worker`, no longer count as undeclared packages in the phantom-dependency check or its generated ESLint rule.
- The workspace-package rule now lets through a subpath a package exports. Importing `@acme/ui/button` when `@acme/ui` lists `"./button"` in its `exports` is using the package's public API, not reaching into its source, so neither `check` nor ESLint reports it any more; a subpath no export covers, or one an export blocks with `null`, still breaks the rule, and a package without `exports` still exposes only its name. Imports of a package that exports every subpath (`"./*"` with nothing blocked) no longer count as evidence for the rule, since none of them could break it. Before, every subpath counted as a deep import, so the rule was rejected on repositories that import mostly through `exports` and its evidence counted their public imports as breaks. Run `archprint generate` again to update an adopted rule. In a pnpm repository (one with a `pnpm-lock.yaml` or `packageManager: pnpm@...`), archprint now also reads the workspace's packages from `pnpm-workspace.yaml`, which is what pnpm uses, instead of a `workspaces` list in `package.json` that pnpm ignores and that may be out of date.
- Written rules (`gap-report`, and the `doc-` rules that `check` and ESLint enforce) now follow a workspace package's `exports` and find the workspaces nested below the folder you pass. An import of a package subpath such as `@acme/ui/button` follows the package's `exports`, an exact key first and then the most specific `*` pattern, as Node.js matches them, and resolves to the first of that key's targets that is a source file in the repository (a `.js` target counts as its `.ts` source). Before, archprint looked for the subpath under the package folder, so a `targets` rule missed every import that `exports` sends to another folder, such as `./src/`. Declaration files (`.d.ts`) are now tried last, for a package's root import too, so where a package lists both its built types and its source, the source is used whether or not the package has been built. Archprint also reads the JavaScript workspaces nested below the folder you pass, such as a pnpm workspace in `web/` of a repository whose root is not one; before, no workspace package resolved there at all. If two workspaces have a package of the same name, the shallower workspace's package is used.

## 0.18.1

### Patch Changes

- Archprint now reads solution-style `tsconfig.json` files the way TypeScript does. When the app's `tsconfig.json` only lists other projects (`"files": []` plus `references`, the layout create-vite, Angular and Nx generate), the settings for the app's files live in a referenced project such as `tsconfig.app.json`. Two things went wrong there. A full scan (`--deep`, and `generate` by default) missed every import of a `.tsx` file. And when the `paths` aliases were only in the referenced project, every scan missed the imports through them: the files they import were listed as orphans, and the rules could not see those imports. Archprint now reads the referenced projects that compile the app's files, and a full scan resolves each file with the compiler options of the project that includes it. Apps without `references` are unaffected. If two referenced projects map the same alias to different folders, the fast scan leaves that alias unresolved rather than guess, and an alias in the `tsconfig.json` itself takes precedence.

## 0.18.0

### Minor Changes

- `archprint generate <app> --declare <mapping>` enforces the rules your CLAUDE.md or AGENTS.md states, from the mapping your agent wrote for `archprint gap-report`. It verifies the mapping again and adopts, for that app, every sentence the code follows, and with `--baseline` also those it breaks today, recording each breaking file as an exception that only shrinks. A sentence it cannot adopt is listed with the reason. Each adopted rule becomes an `archprint/doc-<name>` rule in `.archprint/eslint.mjs` whose error message is your team's sentence and its line, for example `Components never call fetch directly. (CLAUDE.md:2)`, and `archprint check` finds the same breaks, file for file and line for line, and reports the ones a pull request adds. `archprint allow` and `archprint explain` (and the `archprint_explain` MCP tool) take its id. Later runs of `generate` keep these rules, refuse a new break, and say when a rule's sentence is no longer in its file. dependency-cruiser does not enforce them.
- New `archprint gap-report` command and `archprint_gap_report` MCP tool check the architecture rules your CLAUDE.md or AGENTS.md already states against your code. Your agent maps each rule-like sentence to one of a few templates, quoting it: forbid an import (by path, package or named export), forbid a global such as `fetch` or `process.env`, allow no new files under a folder, or point at a rule archprint already finds. Archprint checks the quote is in the file and the mapping matches real files, then groups every sentence: enforce now, enforce with a baseline (the files and lines that break it today), already an archprint rule, check the mapping, or guidance only. Each mapping is restated in plain words next to the quote, so you can compare the two, and a rule nothing in the code breaks is marked as such. Archprint calls no model: every number is computed from your code. Nothing is written.

### Patch Changes

- `archprint check` now counts the breaks of each rule in a file, the way ESLint's bulk suppressions do, with the base branch as the baseline. Earlier, a file that already broke a rule could break it again in a pull request unnoticed, as long as the new break looked like the old one (the same rule and the same import or global). Now, when a file breaks a rule more times than it did on the base, `check` reports it and lists every break of that rule in the file, since which one is new cannot be told; fewer than on the base counts as fixed.
- `archprint check` now points at the right line in Vue and Svelte files. Lines were counted from the start of the `<script>` block rather than the file, so an annotation on a `.vue` or `.svelte` file landed above the import that broke the rule.

## 0.17.0

### Minor Changes

- `archprint generate --rules <ids> --baseline` adopts the rules you name even when they fall short of the confidence gate, so a team with existing breaks can stop new ones now instead of waiting for a clean codebase. Every file that breaks a named rule today is recorded as an exception and listed. The rule's evidence in `.archprint/config.json` stays as measured. From then on the exceptions only shrink, and a later plain `generate` keeps the rule. Naming an already adopted rule with `--baseline` accepts its new breaks and lists them. A rule your code does not follow, with under 80% of the files it applies to keeping it, cannot be adopted this way, and `--baseline` needs `--rules`. A rule card written with `--expand` shows such a rule's measured status.
- `archprint check` now reports how the recorded exceptions of your adopted rules stand: how many still break their rule, and which ones the change fixed, for example `Exceptions: 3 left, 1 fixed in this change.` It follows renamed files. When a fixed exception is still recorded in `.archprint/config.json`, it says to run `archprint generate` so the rule applies there too. The line also appears in the GitHub step summary, and the JSON output gains an `exceptions` field.

## 0.16.0

### Minor Changes

- `archprint generate` no longer adds a new break to an adopted rule's exceptions. Earlier, each run rebuilt the exceptions from the current code, so a violation that had been merged (`check` only warns unless `--fail-on new`) became a permanent exception the next time anyone ran `generate`, without a word. On a small repo the same slip could drop the rule instead. Each adopted rule now records its exceptions in `.archprint/config.json`. When a file breaks an adopted rule and was not one of them, `generate` stops, names the rule and the file, and writes nothing, so the rules already in `.archprint/` stay in force. Fix the file, or accept it with `archprint allow <rule> <file> --reason "..."`. When an exception is fixed, the next `generate` enforces the rule on that file and lists it. Rules adopted by an earlier version have their current exceptions recorded on the first run, which lists every one. A forbidden-import (AP-) rule adopted from a full scan and regenerated with `--fast`, or the other way round, has its exceptions measured again and listed rather than compared, because the two scans see different imports. `generate --reset` starts afresh.
- `generate --check` now runs through your repo's own ESLint. It used the copy of ESLint that came with archprint, which `npx archprint` does not install, so under `npx` it failed with "Cannot find package 'eslint'". It now loads ESLint from your repo (version 9 or later) and exits with code 2 and a clear message when there is none. Once the rules are wired, it lints through your ESLint config, the one your editor and CI run, instead of the generated rules on their own, and names any generated rule that config turns off, downgrades to a warning or overrides for some files, with an example file. If your ESLint config fails to load, the check stops with exit code 2 and the error instead of passing. Before wiring, it checks the generated rules on their own, says so, and uses your repo's TypeScript parser.
- `archprint explain`, the `archprint_explain` MCP tool and `archprint allow` now accept a rule by any of its names: its id (`no-lib-to-components`, the one `generate --rules` takes), its label (`lib !-> components`), or its ESLint name (`archprint/no-lib-to-components`, or `archprint/no-ui-layer-in-server-entry` for `AP-002`), in any case and spacing. `generate --rules` accepts the ESLint name too. Earlier, `archprint_explain` took only the label and `archprint explain` only the forbidden-import (AP-) ids, so the name ESLint printed was rejected. `archprint explain` now explains every rule `scan` lists, with its evidence, the files that break it and how to adopt it. Each rule in `scan --json` and `archprint_scan` now carries its `id`.
- The test-isolation, import-style, console-isolation, env-access and workspace-package rules in `.archprint/eslint.mjs` now run under their own names (`archprint/test-isolation`, `archprint/import-style`, `archprint/console-isolation`, `archprint/env-access`, `archprint/workspace-package`) instead of ESLint's `no-restricted-imports`, `no-console` and `no-restricted-properties`. ESLint keeps one setting per core rule for each file, so a repo that configured one of those rules itself, for a folder or the whole project, silently replaced archprint's rule there (or the other way round). Both now apply side by side. Each rule counts imports the way the scan does: test-isolation and workspace-package ignore type-only imports, and all three import rules check `import()` calls. Run `archprint generate` to refresh the file. If you silenced an archprint finding with an `eslint-disable` comment naming the core rule, rename it to the `archprint/` name. Rule ids in `config.json`, `check` and `allow` are unchanged.
- `archprint generate` now keeps the rules you adopted on every run, not only with `--only` or `--rules`. Earlier, a plain run (including `generate --check`) reset `.archprint/` to the default rule set, so rules you had adopted with `--rules`, such as layer boundaries, disappeared without a word. A plain run now refreshes the adopted rules alongside the defaults and says which it kept. To start again from the default set, pass the new `--reset` flag: it lists every adopted rule it removes. `init --force` does the same. `generate --check` on its own now checks the rules already in `.archprint/` and writes nothing; with other flags it generates first, as before.
- `archprint init` no longer edits your `README.md` unless you pass `--readme`, the same flag `generate` takes. The README section it writes now lists each adopted rule with this repo's evidence (for example "`AP-001`: A request handler must not import the database client directly (45 of 45 files it applies to follow it)"), plus what your code follows that no rule enforces and what is held for review. It no longer carries the "% of comparable repos" figures or the "Worth adopting" list; those stay in the terminal output and in `archprint recommend`. `init` now ends by listing every file it wrote or changed.
- `archprint scan` reports far fewer false orphan modules, and lists the files only tests import separately. A file now counts as used when anything references it: a type-only import, an `export ... from` through a barrel, an `import()` call, or a tool config that names it (such as Vitest's `setupFiles`). Next.js metadata files (`robots`, `sitemap`, `manifest`, `opengraph-image`, `twitter-image`, `icon`, `apple-icon`), `proxy` and `instrumentation-client` at the app root, and Storybook stories are recognized as entries. Production files that only their own tests import, which is dead code the tests keep alive, now come first, under "Imported only by tests". On five open-source Next.js apps the orphan list shrank from 389 to 246 files without listing any file the earlier version did not. `detectOrphans` in the library API no longer takes an options argument, and its result adds `testOnly`.

### Patch Changes

- The generated dependency-cruiser rules now exempt exactly the files a rule tolerates. Earlier, an exemption matched any path ending the same way, so in a monorepo the exempted `src/lib/legacy.ts` of `apps/web` also silenced a new break at `apps/api/src/lib/legacy.ts` when dependency-cruiser checked both apps, and within one app it also exempted, say, `src/lib/legacy.ts` when only `lib/legacy.ts` was meant. An exemption still applies whether dependency-cruiser runs from the repository root or inside the app. Run `archprint generate` to refresh `.archprint/dependency-cruiser.json`.
- Fixed three ways the generated dependency-cruiser rules could be wrong. The role-layering, feature-slice, app-isolation, stories-isolation and UI/data rules did not exempt the files they were inferred with, so adopting one could fail dependency-cruiser straight away on code that already broke it. Those rules, the public-API rules and test isolation also ignored `archprint allow`, so an allowed file kept failing in dependency-cruiser. All of them now exempt both. For an app below the repository root, such as `apps/web`, the public-API, feature-slice and app-isolation rules matched paths without the app's folder, so dependency-cruiser, which reports `apps/web/src/...`, never applied them. They now include it. Run `archprint generate` to refresh `.archprint/dependency-cruiser.json`. `archprint allow` now says to regenerate for these rules too, instead of telling you to edit dependency-cruiser's config by hand.
- `archprint check` now gives console-isolation and env-access findings a line number: the line of the first `console.*` call or `process.env` read in the file. Earlier, those findings carried no line, so `--format github` annotated the whole file instead of the line.

## 0.15.0

### Minor Changes

- `generate --only <family>` and `generate --rules <ids>` now add to the rules you adopted before instead of replacing them. Earlier, a scoped run kept only what it generated, so `--only layer` on a repo with no layer rules removed every adopted rule and `.archprint/eslint.mjs` with them. A scoped run now lists the rules it kept and names any earlier rule the current code no longer supports. A plain `archprint generate` still resets to the default rule set.

### Patch Changes

- `.archprint/config.json` now records every rule written to `.archprint/eslint.mjs` or `.archprint/dependency-cruiser.json`. Env access, workspace-package API, role layering, feature slices, app isolation, stories isolation and UI/data separation were enforced but missing from the adopted rules, so `archprint check` did not report them and `archprint allow` refused them. The enforced, report-only and held-for-review lists in `config.json`, the `--readme` section and the `init` summary now follow the adopted rules: a held rule you adopt with `--rules` is listed as adopted, and a recommended rule you did not adopt is listed as report only rather than as adopted.

  If your CI pins an archprint version (for example the GitHub Action's `archprint-version`), use 0.15.0 or later there too: an older `archprint check` stops with an error on a `config.json` that records these rules.

## 0.14.0

### Minor Changes

- Undeclared (phantom) dependencies and the server/client boundary can now be enforced with plain ESLint, like layer boundaries. When your repo does not use dependency-cruiser, `generate --include-structural` writes them into `.archprint/eslint.mjs` as `archprint/no-phantom-dependencies` and `archprint/no-server-only-in-client`, with no extra plugin, and they pass on the code they were generated from. The phantom-dependency rule reads your `package.json` each time ESLint starts, so declaring a package is enough; no regenerate. Both rules are now adopted, whichever tool enforces them: `archprint check` reports a new break and `archprint allow` accepts one.

  Circular dependencies are now enforced. When your code has no cycle (and enough files to say so), `generate` and `init` adopt the rule `no-cycles`, without `--include-structural`, and `archprint check` reports each import that closes a new cycle in a pull request; to accept a cycle, allow every file in it. There is no lint rule for cycles, because finding one needs the whole import graph. The phantom-dependency and server/client rules still need `--include-structural`. Older archprint versions do not recognize these adopted rules, so update archprint in CI (for example the GitHub Action's `archprint-version`) before you regenerate.

  Fixes: the server/client rule written for dependency-cruiser flagged every server module that correctly imports `server-only`, and missed the client component importing it; it now covers exactly the client components and server-only modules the scan found. A module that only mentions "server-only" in a comment or a string is no longer treated as server-only. A "use client" directive after a byte-order mark or a shebang line is recognized. `#` subpath imports and `scheme:` specifiers (such as `bun:test`) are no longer reported as undeclared packages.

- Package internals and entry purity can now be enforced with plain ESLint too. When your repo does not use dependency-cruiser, `generate --include-structural` writes `archprint/no-dependency-internals` (importing a package's `src` or `internal` folders) and `archprint/no-import-framework-entry` (importing a page, layout or route handler from other code) into `.archprint/eslint.mjs`. Both pass on the code they were generated from and are adopted, so `archprint check` reports a new break and `archprint allow` accepts one. The entry rule recognizes pages and routes by their path, so new routes are covered without regenerating.

  Fixes: the entry-purity rule written for dependency-cruiser flagged a page importing another page, test files, and the imports that already existed when it was generated; it now exempts all three. Package-internals evidence no longer counts `#` subpath imports or `scheme:` specifiers as packages.

## 0.13.1

### Patch Changes

- The README now walks through adopting the layer boundaries you agree with: read them with `scan`, write the ones you chose with `generate --include-structural --rules`, and reference them with `wire`.

## 0.13.0

### Minor Changes

- Layer boundaries can now be enforced with plain ESLint. When your repo does not use dependency-cruiser, `generate --include-structural` writes each layer boundary into `.archprint/eslint.mjs` as its own rule, such as `archprint/no-lib-to-app`, with no extra plugin, and `recommend` names ESLint as its enforcer. The rule checks `.ts` and `.tsx` files and reads imports the way the scan counted them: relative paths and tsconfig aliases, side-effect and dynamic imports, but not type-only imports, test files, or the folders the scan skips (`build`, dot-folders, and the ones your `.gitignore` excluded when you generated). It exempts the files that already broke the boundary, so it passes on the code it was generated from. Layer rules are now adopted: `archprint check` reports a new break, and `archprint allow` accepts one, whether ESLint or dependency-cruiser enforces it. Older archprint versions do not recognize adopted layer rules, so update archprint in CI (for example the GitHub Action's `archprint-version`) before you generate with `--include-structural`.

  `--rules` now selects any generated rule, not only `AP-` rules: an `AP-` id or the name ESLint prints for it, a family rule such as `import-style` or `test-isolation`, or a layer rule by its id (`no-lib-to-app`) or by the label `scan` prints (`lib !-> app`). It keeps only the rules it names, so `--rules AP-002` no longer also writes the other families. A name that matches no rule the run would generate is an error that lists the ones it would, and nothing is changed.

### Patch Changes

- Layer boundaries written for dependency-cruiser no longer fail on their first run. A rule such as `lib` must not import `app` used to flag the few existing exceptions it was generated with, test files, and type-only imports, none of which the scan counts. It also matched every folder with the layer's name at any depth, so a `lib/` folder inside a route like `app/(dashboard)/lib/` counted as the `lib` layer. The rule now matches only the folders the layer was found in, and in a monorepo it matches paths the way dependency-cruiser reports them from the folder where you ran archprint.

  Layer boundaries are now found from imports as written in every scan mode, which is how dependency-cruiser, ESLint and ts-arch read them. A full scan used to follow re-exporting index files and could find a boundary its own rule then contradicted. Exceptions to other dependency-cruiser rules also match on a folder boundary now, so an exception for `lib/legacy.ts` no longer exempts `mylib/legacy.ts`.

## 0.12.4

### Patch Changes

- Three fixes found by reviewing archprint's output on popular open-source repos before writing about them:

  - Circular dependencies are now shown as a real import loop, for example `a.ts -> b.ts -> a.ts`, plus how many other files are in the same cycle. Before, the files of a cycle were listed in alphabetical order with arrows between them, which read like an import chain that did not exist.
  - The rule that request handlers must not import the database client directly now recognises Supabase (`@supabase/supabase-js`, `@supabase/ssr`, `@supabase/postgrest-js` and the older auth helpers) and your own modules that create a Supabase client, so an app that reaches its database through Supabase is no longer told its handlers avoid the database. Database client modules created with a type argument, such as `new Kysely<DB>(...)` or `createServerClient<Database>(...)`, are recognised too.
  - The UI and data rule now says what it measures: components that never import the data layer directly. It no longer claims they go "through services", which it does not check.

## 0.12.3

### Patch Changes

- Files in folders whose names glob patterns read as syntax, such as Next.js `[id]`, `[...slug]`, `(group)` and `@slot` route folders, now work everywhere. `archprint allow` accepts them, and `archprint check` no longer stops with "must be a file path relative to the app" afterwards. The ESLint rules exempt exactly that file: before, a path like `app/[id]/page.tsx` could exempt the wrong file (`app/i/page.tsx`) and keep flagging the right one. An allowed exception must still name one file; `*` and `?` are refused.

  Two related fixes: an exception to an `AP-` rule no longer also exempts a file in another folder whose path merely ends the same way, and the review-held env-access and workspace-package rules now exempt their existing exceptions when the ESLint config sits at the repository root of a monorepo.

## 0.12.2

### Patch Changes

- `archprint eject` now restores `README.md`, `.prettierignore` and `.npmignore` byte for byte. Before, a file without a final newline, with several trailing newlines, or with mixed line endings came back slightly different after archprint added and then removed its section.

## 0.12.1

### Patch Changes

- The rule that keeps request handlers away from the database client (AP-001) no longer adds a request handler that creates its own client to the list of modules it forbids importing. Such a handler is still reported as breaking the rule; it just no longer changes the rule's definition, so `archprint check` does not show AP-001 as changed when a pull request adds or removes one.

## 0.12.0

### Minor Changes

- `.archprint/` is back to two files for a single linter: `config.json` and `eslint.mjs`. The adopted rules and the exceptions you allow with `archprint allow` now live in `config.json` (its `rules` and `allowed` lists) instead of `rules.json` and `allow.json`. Setups from 0.9.0 to 0.11.x keep working: `check` still reads `rules.json` and `allow.json`, including on a base branch that has them, and the next `archprint generate` moves both into `config.json` and deletes them. `check` also warns when a pull request removes the rules from `config.json`.

## 0.11.0

### Minor Changes

- New `archprint allow <rule> <file> --reason "..."` records a justified exception to an adopted rule in `.archprint/allow.json`. `archprint check` (and the GitHub Action and the MCP `archprint_check` tool) no longer counts an allowed exception as a new violation, lists every exception added in the pull request with its reason, and points out exceptions the code no longer needs. The next `archprint generate` stops ESLint flagging the allowed file for that rule. When `init` or `generate` re-infers the rules, allowed exceptions are left out of each rule's evidence, so allowing one justified break never drops the rule it breaks (and an allowance never promotes a rule that was not adopted). An exception without a reason is rejected, and `allow` refuses a rule that does not report the file. `--remove` takes an exception back out, and `eject` removes the list.

  ESLint also gets more precise for the rules that share `no-restricted-imports` (import style, test isolation): a file excepted for one of them is still checked by the others. Before, an exception for one of them exempted the file from all of them.

  File exceptions in the generated ESLint config, including the ones grandfathered at adoption, now also match when your ESLint config sits at the root of a monorepo: each one is written with the app's path in front as well as relative to the app, so it applies to that app only.

## 0.10.5

### Patch Changes

- archprint now deletes and writes only where it should. Before, `generate`, `init`, `eject` and `migrate` removed every path listed in `.archprint/config.json`, the outputs manifest, or an old `archprint.json`'s `rulesDir`, so an edited file could make them delete folders elsewhere in the repo or outside it.

  - Only paths inside archprint's own folder are deleted, with symlinks resolved first. The old `archprint-rules/` folder is cleared file by file from its manifest and removed only when empty, so files you put there stay.
  - If `.archprint` (or the old rules folder) is a symbolic link, archprint refuses to write or delete through it.
  - Every file archprint writes stays inside its folder: a file there that is a symbolic link is replaced with a real file, never written through, and a linked subfolder pointing elsewhere is refused.
  - The README, `.prettierignore`, `.npmignore` and the linter configs archprint edits are left alone when they link outside the repository.
  - `archprint eject --out` must name a folder inside the repository, not the repository itself, and an `--out` inside the repository that a symbolic link redirects elsewhere is refused.

## 0.10.4

### Patch Changes

- The "Adopted rules" section in your README now says what `archprint wire` and `archprint eject` do, instead of saying the rules run "once `archprint wire` connects them", which read as "not yet" after you had already wired them.

## 0.10.3

### Patch Changes

- The README section `archprint init` writes no longer says the rules are already wired into your linter. It lists them under "Adopted rules" and says they run in your linter once `archprint wire` connects them, which is true before and after you run `wire`.

## 0.10.2

### Patch Changes

- The MCP `archprint_scan` and `archprint_explain` results now say, for each rule, whether archprint enforces it, holds it for review, or only reports it (`adoption`: `enforce`, `review` or `report-only`). Before, they gave only the gate status (AUTO or SUGGEST), and agents described rules archprint holds for review as enforced.

## 0.10.1

### Patch Changes

- `archprint check` now reports when a pull request removes the adopted rules. If the change deletes `.archprint/rules.json` or `config.json` (or the whole `.archprint/` folder) that the base commit has, it warns and lists every rule that stops being checked, instead of saying it did not run. It still does not fail the job; the docs show how to require a code owner's review for such a change.

## 0.10.0

### Minor Changes

- The MCP server has a fourth read-only tool, `archprint_check`. An agent can ask which of the repo's adopted rules its current change breaks, uncommitted edits included, and fix them before it finishes. It returns the same report as `archprint check --format json`, without the version field. That JSON now also names the `app` the file paths are relative to, which matters in a monorepo. `archprint_explain` now returns how to fix a violation and when not to adopt the rule for the database and UI rules, and its description says what it adds over `archprint_scan`. The recommendation for those rules is labelled "Forbidden imports (database client or UI in request handlers)".

  `archprint check` no longer uses a git worktree for the base commit: it copies the base commit's files to a temporary folder with git's own plumbing, so it runs none of the repository's git hooks and writes nothing inside `.git`. A branch or commit name starting with `-` is refused.

## 0.9.0

### Minor Changes

- Add `archprint check`, which reports only the violations a change introduces, compared with a base branch or commit, for the rules your team adopted with `init` or `generate`. It works in any CI. On GitHub, `--format github` shows each finding inline on the pull request, with its evidence, plus a step summary that also counts the violations the change fixed. It warns by default; `--fail-on new` fails the job so you can make it a required status check. `--format json` and exit codes (`0` ok, `1` new violations, `2` the CI setup is wrong) cover other CI systems.

  `init` and `generate` now also write `.archprint/rules.json`, the exact definition of each adopted mechanical rule, which `check` uses so it never re-infers a rule. If you set up archprint with 0.8.x or earlier, run `archprint generate` once; until then `check` reports that it did not run.

### Patch Changes

- The same repository now gives the same output on every machine. archprint reads files in name order instead of the order the filesystem returns them, which differs between macOS and Linux, so an example exception or a generated fixture no longer changes between a laptop and CI.
- `generate --expand` now writes each forbidden-import rule's files from that rule. Before, the database rule (AP-001) got the UI rule's ESLint message, rule card text and fixtures, so its failing fixture imported a UI component that AP-001 never flags. Each rule's message now states the rule, its card lists what it forbids, and its failing fixture imports something the rule really reports: one of the repo's own exceptions when there is one, otherwise the database wrapper or component folder archprint found.
- The local MCP server now says plainly when it is given a repository URL instead of a directory, and points to `archprint mcp --http` for scanning a public repository by URL. Before, it reported a missing `tsconfig.json` under a path built from the URL. It also reads a `file://` URL as the local directory it names, and ignores spaces around a path.
- Plainer wording. The database and UI rules (AP-001, AP-002) now say "request handler" instead of "request-entry" or "server-entry" file, in scan output, ESLint messages, rule cards and fix guidance. `scan` prints each of these rules as a sentence followed by "N of M files it applies to follow it".

## 0.8.3

### Patch Changes

- The MCP server is ready for MCP directories. Each tool now has a human-readable title and is marked read-only and non-destructive, so clients can show it as safe to run (the remote `--http` tools are also marked as reaching the internet). The package declares its MCP Registry name, and every release publishes to the official MCP Registry automatically. `archprint scan` now labels each rule group the same way `init` and `recommend` do: dependency hygiene and dependency declaration read "review before enforcing", and circular dependencies read "report only". The README lists example prompts to ask your agent.

## 0.8.2

### Patch Changes

- `archprint init` and `archprint recommend` no longer list circular dependencies under "Enforcing now". Archprint does not write a lint rule for cycles, so nothing was enforcing them. They now appear under a new "Report only" group, which is also recorded as `reportOnly` in `.archprint/config.json`, in `recommend --json`, in the MCP `archprint_recommend` result, and in the README section `init` writes.
- The README is reorganised so anyone can follow it: a plain-words explanation of what Archprint does and who it is for, the demo recordings and a "try it in your browser" link up front, a section on using it with AI coding agents (with the measured comparison), a short quick start, and a plain explanation of how it decides which rules to trust before the reference material. It also corrects the list of rule families that turn on automatically: dependency declaration is held for review, as the detector table and `init` already said. Circular dependencies are now described as reported rather than enforced, since no lint rule is written for them yet, and the README states precisely what makes generated rules green on your code and what `generate --check` adds.

## 0.8.1

### Patch Changes

- `archprint eject` now restores an ESLint config exactly when its array starts on the same line as its first entry (for example `export default [{ ignores: ['dist/'] }, ...]`). `wire` used to break that line to insert its reference, and `eject` left the line break behind. `wire` now inserts the reference inline on that line, and `eject` removes exactly what it added. Configs with a multi-line array are unchanged.
- Scanning now skips the same files git does for `.gitignore` patterns where a wildcard has to reach past a partial match, such as `f*o/*/*` matching `foo/b/c`. Before, a few such patterns failed to match and those files were scanned. Scan output is unchanged on the large repositories we checked.
- The README and docs show three short recordings (scan, explain, and asking Claude Code in plain words) and a measured comparison of the same question in Claude Code with and without archprint on the demo app, with the method, harness and every answer published alongside.

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
