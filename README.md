# Archprint

[![npm version](https://img.shields.io/npm/v/archprint.svg)](https://www.npmjs.com/package/archprint)
[![CI](https://github.com/Tommkruix/archprint/actions/workflows/ci.yml/badge.svg)](https://github.com/Tommkruix/archprint/actions/workflows/ci.yml)
[![npm downloads](https://img.shields.io/npm/dm/archprint.svg)](https://www.npmjs.com/package/archprint)
[![license](https://img.shields.io/npm/l/archprint.svg)](./LICENSE)
[![docs](https://img.shields.io/badge/docs-live-blue)](https://tommkruix.github.io/archprint/)

**Mine the architecture rules your repo already enforces, with the evidence attached.**

Archprint scans a TypeScript repository's real import graph, finds the architectural boundaries the code
already respects, and turns the ones that pass a statistical confidence gate into deterministic, ready to
install lint rules. Every rule ships with the evidence behind it: how many files conform, how many break it,
and how confident the inference is.

**Find the rules your code already follows:**

![archprint scan listing the rules a Next.js API already follows, with the evidence for each](docs/public/demo/scan.gif)

**See the evidence behind one:**

![archprint explain showing the confidence gate behind AP-001](docs/public/demo/explain.gif)

**Enforce them in ESLint, watch a break get caught, and remove it all again:**

![archprint init and wire adding the rules to ESLint, lint catching a route that imports the database, and eject restoring the config exactly](docs/public/demo/enforce.gif)

**Or just ask your agent.** Claude Code calls archprint over MCP on its own:

![Claude Code answering "What architecture rules does this repo already follow?" by calling archprint](docs/public/demo/claude-code.gif)

**Cursor works the same way, with Grok 4.7 rather than Claude.** In the desktop app's chat, its agent called
archprint's scan tool on its own; this screenshot shows the tool result and the answer:

![Cursor's desktop chat, running Grok 4.7, answering from archprint's scan result: the rules and lib/db.ts as the one exception](docs/public/demo/cursor-app.png)

In the terminal (`cursor-agent`), it asks once before running the tool, then answers from it:

![Cursor's terminal agent, running Grok 4.7, approving archprint_scan once and answering with the rules and lib/db.ts as the one exception](docs/public/demo/cursor.gif)

**Measured, with and without archprint.** The same question in Claude Code (Opus 5.5) on the demo app (70
files), five runs each, median [range]:

|                   | Without archprint         | With archprint            |
| ----------------- | ------------------------- | ------------------------- |
| Tokens read       | 81k [58k to 96k]          | 52k [52k to 52k]          |
| Tokens written    | 1.1k [1.1k to 1.4k]       | 0.6k [0.6k to 0.6k]       |
| Cost per question | $0.083 [$0.078 to $0.153] | $0.037 [$0.032 to $0.076] |
| Time              | 17 s [15 to 19]           | 10 s [9 to 31]            |
| Tool calls        | 5 [4 to 10]               | 2 [2 to 2]                |

Both found the main rule (routes reach the database only through `lib/services/`). With archprint, every run gave
the evidence for each rule and named the one file that breaks one (`lib/db.ts` reads `process.env` outside the
config layer); no run without it noticed that. Without archprint, Claude also described naming conventions
archprint does not check. About 50k of the tokens read in both columns are Claude Code's own system prompt. This
is one small repo; larger ones are not measured yet.
[Method, harness and every answer](https://github.com/Tommkruix/archprint-demo/tree/main/bench).

**Try it in your browser, nothing to install:** [open the demo in StackBlitz](https://stackblitz.com/github/Tommkruix/archprint-demo).
The scan runs as soon as it opens, and the [demo's README](https://github.com/Tommkruix/archprint-demo#try-it)
walks through enforcing a rule in ESLint, breaking it, and asking for the rules over MCP.

Your `CLAUDE.md` is guidance. Your lint rules are enforcement. Archprint closes the gap by generating the
enforcement from patterns your codebase already demonstrates, so you adopt rules you can trust instead of
authoring them by hand.

When an AI agent is doing the writing, it can read those inferred rules and their evidence on demand through
Archprint's read-only MCP server (`archprint mcp`), so the context it works from is your codebase's real,
evidence-backed boundaries rather than a hand-written summary. It reports; enforcement still runs in your
linter. See [Use with AI agents](#use-with-ai-agents-mcp).

Validated at scale: `scan` and `recommend` ran across all 92,861 real public TypeScript repositories with zero
crashes, and the full `init`/`wire`/`eject` round-trip ran clean on a 2,000-repo stratified sample. A companion
benchmark, [AgentRuleBench](https://github.com/Tommkruix/agentrulebench), measures the guidance-vs-enforcement
question directly (a pre-registered, honest null result on the boundary it tested).

**What auto-enforces vs. what you review.** Archprint is honest about which of its inferences it will stand
behind unattended. An adversarial correctness audit (three rounds over four real repositories) found that the
_mechanical_ families, ones grounded in unambiguous signals (no cycles, production must not import tests, no
`console` in library code, no undeclared dependencies, deep-relative import style, public-API barrels, and the
DB/UI-in-server-entry rule), had zero false positives every round. So those auto-generate as enforcement. The
families held for human review by default, emitted only with `--include-structural`, are the ones that infer a
"layer" or "role" from paths, which can be wrong (layer and role boundaries, UI/data separation, entry purity,
server/client, feature-slice and app isolation), plus dependency hygiene, whose enforcement can over-flag.
Nothing that could be wrong is written as enforcement without you opting in.

> Status: published on npm and safe to run on your real repo. Every rule is review-gated by default,
> reversible in one command (`archprint eject`), and deterministic, and a rule archprint marks
> "enforce now" is checked to pass on your code before it says so. `scan` and `recommend` are stable;
> the structural families stay review-only while they are hardened. Versioning is still 0.x, so the CLI
> surface and rule format can refine between minor versions (the compact `.archprint/` layout arrived in
> 0.6.0; `archprint migrate` upgrades an older setup in place), but the analysis is not experimental.

## What makes it different

Established TypeScript tools (dependency-cruiser, eslint-plugin-boundaries, Nx, Sheriff, ts-arch) all
**enforce** architecture rules you write by hand. Archprint **infers** them from the actual import graph and
**gates each one on statistical evidence** before proposing it. Across the TypeScript ecosystem, no other tool
does either (see the comparison below). It then emits into those existing tools' formats, so it complements
your stack rather than replacing it.

## Install

```bash
npm install --save-dev archprint
```

Then run it (or use `npx archprint …` without installing):

```bash
npx archprint scan .
```

Or build from source:

```bash
git clone https://github.com/Tommkruix/archprint
cd archprint
npm ci
npm run build
node dist/cli.js scan <path-to-your-app>
```

Requires Node >= 20. Point Archprint at an app directory that has a `tsconfig.json` (for a monorepo, a
package such as `apps/web`; a monorepo root is fine too, Archprint discovers the app directories).

## Quick start

```bash
# One-shot setup: detect the stack, enforce the rules your code already follows,
# and record what to adopt next in .archprint/config.json
archprint init apps/web

# See the rules your repo already follows, with the evidence
archprint scan apps/web

# Write the auto-trusted (mechanical) rules to .archprint/, only for the linters your repo uses.
# Structural-inference rules are held for review; add --include-structural to emit them too.
archprint generate apps/web

# Confirm the generated rules pass on your repo before wiring
archprint generate apps/web --check

# Inspect the gate evidence behind one rule
archprint explain AP-002 apps/web

# Generate a single rule by id after reviewing it (including a SUGGEST rule)
archprint generate apps/web --rule AP-001

# Recommend a rule set from the evidence and the detected stack (fresh repos too)
archprint recommend apps/web

# Reference the generated rules from the enforcement tools your repo uses (managed, reversible)
archprint wire

# Remove archprint's files and any wired references (clean uninstall)
archprint eject

# Upgrading from 0.5.x? move an older archprint-rules/ setup to the .archprint layout
archprint migrate
```

Re-running `generate` (or `init`) refreshes the files in `.archprint/` and removes any rule the
evidence no longer supports, so the output never drifts from the current codebase. `wire` detects the
enforcement tools your repo already uses (a flat eslint config, a `.dependency-cruiser.json`) and inserts a
single managed reference into each, one that survives those regenerations; `eject` removes archprint's files
and every wired reference, restoring each config exactly. For a tool config it cannot safely edit (a JS
dependency-cruiser config, say), it prints the exact snippet to paste. The flagship forbidden-import rules
(AP-) ship as a generated local eslint plugin that the eslint reference activates, so wiring the eslint config
enforces them too, no extra install.

`recommend` sorts every rule family into three tiers: rules your code already
follows (enforce now), rules with thin evidence (review and adopt), and rules that
comparable repos commonly follow but yours does not yet (adopt from day one). Each
recommendation carries the evidence behind it: the share of comparable repos (your
detected stack, else overall) that already enforce that rule, mined from a census of
tens of thousands of public TypeScript repositories. The "adopt from day one" tier is
driven by that census rather than hand-picked defaults, so on a fresh repo, where
there is little code to infer from, it still gives you a stack-aware baseline backed
by what the ecosystem actually does.

## Example

A real scan of [inbox-zero](https://github.com/elie222/inbox-zero) (`apps/web`, 2,232 TypeScript files),
trimmed:

```
Scanned 2,232 TypeScript files
Workspace aliases: 18 resolved

GENERATED RULES
  AP-002  no-ui-layer-in-server-entry      confidence 97%
          Evidence: 216/217 role files conform (99.5% observed)
          Exceptions: 1

LAYER BOUNDARIES (review before enforcing)
  utils !-> app  layer boundary   confidence 99%
          Evidence: 650/653 utils files conform (99.5%); 451 app file(s) depend on utils
  hooks !-> app  layer boundary   confidence 94%
          Evidence: 65/65 hooks files conform (100%); 121 app file(s) depend on hooks
```

`AP-002` is a mechanical family, so it auto-generates as enforcement. The layer boundaries are inferred, so
they are shown for review, not written as enforcement unless you pass `--include-structural`.

Every number is measured from the import graph, not estimated.

## What Archprint detects

Ships as: **Auto** = auto-generated as enforcement (mechanical families, 0 false positives across the
correctness audit). **Review** = held for human review by default; emit with `--include-structural` (the
inferred layer/role can be wrong, so it is not enforced silently). **Report** = surfaced only, never enforced.

Framework aware: Archprint recognizes the stack (Next.js, Nest, SvelteKit, Nuxt, Remix) and classifies UI
components across React (`.tsx`), Angular (`.component.ts`, `.directive.ts`), and Vue and Svelte single-file
components (it reads the `<script>` block of `.vue`/`.svelte` files), so the component-aware rules apply
regardless of framework.

| Detector                           | Rule it can infer                                                                                                          | Ships as |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------- |
| Forbidden imports (AP-001, AP-002) | AP-001: a request entry (route handler) must not import the DB client. AP-002: a server entry must not import the UI layer | Auto     |
| Circular dependencies              | The module graph should stay acyclic (gated on how cycle free it already is)                                               | Auto     |
| Test isolation                     | Production (non-test) code must not import test or spec files                                                              | Auto     |
| Dependency hygiene                 | Import third-party packages by their public entry, not a dependency's `src`/`internal` internals                           | Review   |
| Dependency declaration             | Every imported third-party package must be declared in `package.json` (no phantom/transitive deps)                         | Review   |
| Import style                       | Prefer workspace aliases over deep relative imports (`../../../`)                                                          | Auto     |
| Console isolation                  | Library (non-CLI) code must not call `console.*`                                                                           | Auto     |
| Public API (barrel) boundaries     | Files outside a feature or package must import it through its `index` barrel, not deep import its internals                | Auto     |
| Layer boundaries                   | Files in one layer must not import another, inferred from the dominant dependency direction                                | Review   |
| Role layering                      | Semantic tiers keep their direction (a REPOSITORY must not import a SERVICE, a SERVICE must not import a CONTROLLER)       | Review   |
| Entry purity                       | Framework entries (pages, routes, layouts) must not be imported by other first-party code                                  | Review   |
| UI / data separation               | Reusable UI components must not import the DB/data layer directly                                                          | Review   |
| Server / client boundary           | A Next.js `"use client"` module must not import a `server-only` module                                                     | Review   |
| Feature-slice isolation            | Sibling slices under a `features`/`modules`/`slices`/`domains` container must not import each other                        | Review   |
| App isolation                      | Sibling apps under an `apps`/`services` container must not import each other directly                                      | Review   |
| Env access                         | Read `process.env` only in the config/env layer                                                                            | Review   |
| Workspace package API              | Import a monorepo workspace package by its name, not a deep path into its source                                           | Review   |
| Stories isolation                  | Storybook `.stories` files must not be imported by other code                                                              | Review   |
| Orphan modules                     | Files nothing imports and that are not framework entries (dead code candidates)                                            | Report   |
| Transitive reachability            | A layer boundary that a plain import rule passes but that leaks through an intermediary layer                              | Report   |

## The confidence gate

Archprint never proposes a rule as enforceable on a thin sample. Each candidate is scored with a **Wilson
score lower bound** on its true conformance rate, which fuses the observed ratio and the sample size into one
number, so 5 of 5 clean files is not treated as evidence of a 90% rule but 40 of 40 is.

- **AUTO** (enforceable): the 95% lower bound on conformance is at least 90%, with at most 3 exceptions and a
  confidently classified role.
- **SUGGEST** (provisional): the pattern looks like a rule (at least 80% observed) but the sample is too thin
  to be confident. Surfaced for review, not auto generated.
- **REJECT**: not enough signal.

The statistical gate is necessary but not sufficient: a rule can be statistically clean yet semantically wrong
if the inferred "layer" or "role" is not real. So a second, evidence-based gate sits on top of it: only the
_mechanical_ families (see the "Ships as: Auto" rows above), which an adversarial correctness audit found had
zero false positives across three rounds and four repositories, auto-generate as enforcement. The
_structural-inference_ families are capped at review regardless of their statistical score until they earn the
same clean record. The bias is deliberate and conservative: one wrong enforced rule hurts credibility more than
zero rules.

## Output formats

`archprint generate` writes a minimal `.archprint/` directory: one self-contained rules file per linter your
repo actually uses, plus a `config.json` that records what is enforced and what Archprint manages. It detects
ESLint and dependency-cruiser and emits each rule for a tool you already run, so you are not left with config
for a tool you do not have. `--emit <eslint|dependency-cruiser|all>` forces the format. The default output:

- **`.archprint/eslint.mjs`**: one self-contained ESLint flat-config file that inlines every inferred ESLint
  rule (marker-based forbidden imports, `no-restricted-imports` import-style boundaries, console isolation) and
  needs only eslint, so you can commit it, publish it, or hand it to another repo and adopt it in one line
  (`import archprint from './.archprint/eslint.mjs'`). It self-ignores `**/.archprint/**`.
- **`.archprint/dependency-cruiser.json`** (when dependency-cruiser is present): one `forbidden` ruleset with
  the mechanical boundaries (public-API deep-import, test-isolation); the review-held ones (layer, role-layering,
  feature-slice, app-isolation, entry-purity, dependency-internals, phantom deps) are added only with
  `--include-structural`, after you review them.
- **`.archprint/config.json`**: the system file, what is enforced / held / worth adopting, and the managed
  outputs list `eject` uses.
- **A managed README section** summarizing what is enforced now, held for review, and worth adopting (written
  by `init`, or `generate --readme`), plus a managed `.prettierignore` entry so the generated files stay out of
  your formatter.

`--expand` additionally writes the granular artifacts inside `.archprint/`: the per-family ESLint and
dependency-cruiser JSON, per-rule cards (`.md`) with passing and failing fixtures, the
eslint-plugin-boundaries element-types config, ts-arch tests, and the Mermaid and Graphviz DOT layer graph.

`generate --check` runs the generated ESLint rules against your repo and reports whether they pass, so you
can confirm before wiring. Upgrading from 0.5.x? `archprint migrate` moves an older `archprint-rules/` setup to
this layout and rewires your configs in place.

## Use with AI agents (MCP)

`archprint mcp` runs archprint as an [MCP](https://modelcontextprotocol.io) server over stdio, so an agent can
ask what architecture rules your repo already follows, with the evidence, before it writes code. It exposes three
read-only tools: `archprint_scan`, `archprint_recommend`, and `archprint_explain`. Each rule comes back stated
in plain words, with its evidence and the files that break it, and `archprint_explain` takes any rule label from
the scan (for example `AP-002` or `env-access`). Point Claude Desktop, Claude Code, Cursor, or any MCP client at
it:

```json
{
  "mcpServers": {
    "archprint": { "command": "npx", "args": ["-y", "archprint", "mcp"] }
  }
}
```

If the client says the server failed to start or `npx` was not found, it cannot see your shell's `PATH`. Desktop
apps opened from the Dock or Start menu do not load it, which is common when Node comes from nvm or Homebrew. A full
path to `npx` alone is not enough, because `npx` itself needs `node` on the `PATH`. Point both at the folder that
`dirname "$(which node)"` prints, for example `/opt/homebrew/bin`:

```json
{
  "mcpServers": {
    "archprint": {
      "command": "/opt/homebrew/bin/npx",
      "args": ["-y", "archprint", "mcp"],
      "env": { "PATH": "/opt/homebrew/bin:/usr/bin:/bin" }
    }
  }
}
```

Starting the editor from a terminal also works, because it then inherits your shell's `PATH`.

That default is a local stdio server, and it is the one to use for private code: it runs on your machine against
your local checkout, so your source never leaves it, whichever git host you use.

To scan a public repository by URL instead, run a remote server over HTTP with `archprint mcp --http`. It clones
the repo shallow to a temp dir, runs the same read-only analysis, returns the result, and deletes the clone (only
public `github.com`, `gitlab.com`, and `bitbucket.org` URLs; nothing is written or kept). The tools then take a
`repo` URL (and an optional `ref`). It listens on `0.0.0.0:8848/mcp` by default (set `--host 127.0.0.1` to keep it
to your own machine, or `--port`/`$PORT` to change the port) and answers health checks at `/health` (use this one
on Cloud Run, which reserves `/healthz`) and `/healthz`. Every request clones and scans, so a server anyone can
reach spends compute on anyone's behalf: keep it behind authentication, such as Cloud Run's IAM, unless you accept
that cost.

The tools are read-only (they never write to the repo); use the CLI's `generate`/`wire` to actually emit and
enforce rules.

## How it compares

Verified against each tool's documentation (TypeScript ecosystem). The two columns that matter are the ones no
other TypeScript tool fills:

| Tool                          | Enforces arch rules | Auto-infers from the import graph | Attaches statistical evidence |
| ----------------------------- | :-----------------: | :-------------------------------: | :---------------------------: |
| **Archprint**                 |         yes         |              **yes**              |            **yes**            |
| dependency-cruiser            |         yes         |                no                 |              no               |
| eslint-plugin-boundaries      |         yes         |                no                 |              no               |
| @nx/enforce-module-boundaries |         yes         |                no                 |              no               |
| Sheriff                       |         yes         |                no                 |              no               |
| ts-arch                       |         yes         |                no                 |              no               |
| madge / knip                  |    analysis only    |                no                 |              no               |

Honest caveat: in other ecosystems, [Tach](https://github.com/gauge-sh/tach) (Python) and ArchLint (Java) do
auto-infer module boundaries, so Archprint's specific niche is auto-inference **plus statistical evidence
gating in the TypeScript ecosystem**. Archprint also overlaps in detection with dependency-cruiser (cycles,
orphans, reachability) and knip (dead code); rather than compete, it emits into those tools' formats.

## Commands

| Command                         | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `archprint init [path]`         | Zero-config setup: detect the stack, enforce the rules the code already follows, and write `.archprint/` plus a managed README section. `--expand`, `--include-structural`, `--out <dir>`, `--fast`, `--force`.                                                                                                                                                                                                                                                                                                          |
| `archprint scan [path]`         | Report the rules the repo already follows, with evidence. `--deep` resolves through barrels and aliases.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `archprint generate [path]`     | Write the auto-trusted mechanical rules to `.archprint/` for the linters your repo uses; structural rules held for review. `--emit <eslint\|dependency-cruiser\|all>` forces the format, `--only <family>` and `--rules <ids>` narrow the output, `--check` runs the generated rules against your repo, `--readme` adds the README section, `--expand` also writes the per-family files/cards/fixtures/graph, `--rule <id>` emits one reviewed rule. Also `--include-structural`, `--no-graph`, `--out <dir>`, `--fast`. |
| `archprint migrate` (`upgrade`) | Move an older `archprint-rules/` setup to the `.archprint/` layout and rewire your configs in place. `--dry-run`.                                                                                                                                                                                                                                                                                                                                                                                                        |
| `archprint explain <id> [path]` | Show the gate breakdown for one rule, with a codeframe per exception plus how-to-fix, when-not-to-use, and how-to-enforce.                                                                                                                                                                                                                                                                                                                                                                                               |
| `archprint recommend [path]`    | Recommend a rule set from the repo's evidence and detected stack (works on a fresh repo too); names the installed tool that will enforce each rule.                                                                                                                                                                                                                                                                                                                                                                      |
| `archprint wire`                | Reference the generated rules from the enforcement tools your repo uses (flat eslint config, `.dependency-cruiser.json`) via a managed, reversible reference. `--out <dir>`, `--dry-run`.                                                                                                                                                                                                                                                                                                                                |
| `archprint eject`               | Remove archprint's generated files, its config, the managed README section, and any wired references. `--out <dir>`, `--dry-run`.                                                                                                                                                                                                                                                                                                                                                                                        |
| `archprint mcp`                 | Run archprint as an MCP server so Claude, Cursor, and other agents can call read-only `scan`, `recommend`, and `explain` tools for a repo's inferred architecture rules and evidence. Serves over stdio by default; `--http` runs a remote server that scans a public repo by URL.                                                                                                                                                                                                                                       |

## Documentation

Full docs live in [`docs/`](./docs/): [getting started](./docs/getting-started.md),
[concepts](./docs/concepts.md) (the confidence gate, mechanical vs. structural, fast vs. deep, the
generate/wire/eject lifecycle), and the [rule-family reference](./docs/rules.md) (what each rule detects, how it
ships, and when not to use it).

## Fast and deep modes

`scan` defaults to a **fast** specifier level pass (no type checker). `generate` defaults to a
**deep** pass that resolves through barrels and workspace aliases, since generation is the commitment point.
Structural analysis (cycles, orphans, reachability, public-API) always uses the fast graph: it is faithful to
deep resolution for those, and public-API detection in fact requires it (deep resolution would resolve through
a barrel and erase the barrel-versus-deep signal).

## Determinism

Same repo plus same version produces the same output. Analysis is pure and sorted; there is no randomness.

## Status and roadmap

Archprint is safe to adopt today: every rule is review-gated and reversible via `archprint eject`, the analysis
is deterministic, and `scan`/`recommend` are battle-tested at census scale. The engine (twenty detectors, the
confidence gate, and emitters for a self-contained ESLint file, dependency-cruiser, ts-arch, and the layer
graph) is in place and tested, and an adversarial correctness audit (three rounds, four real repositories) drove
the false-positive rate on auto-generated rules to zero for the mechanical families, which is why those
auto-enforce while the structural-inference families are held for review. Versioning is still 0.x, so the CLI
surface and rule format can refine between minor versions, that is a maturing surface, not experimental
analysis; the compact `.archprint/` layout arrived in 0.6.0, and `archprint migrate` upgrades an older setup
in place.

Production-ready today: `scan` and `recommend` (insight), and auto-enforcement of the mechanical families,
with a self-consistency check at generate time, an `init` scaffolder for fresh repos, and framework coverage
across React, Angular, Vue, and Svelte. Still ahead: hardening the structural families toward auto-enforcement
(a real per-file role-confidence measure, layer-cohesion, role-classifier ordering).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The project lints, type checks, and tests itself; every change keeps
coverage above its thresholds and ships a changeset.

## License

[MIT](LICENSE)
