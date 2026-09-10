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

Your `CLAUDE.md` is guidance. Your lint rules are enforcement. Archprint closes the gap by generating the
enforcement from patterns your codebase already demonstrates, so you adopt rules you can trust instead of
authoring them by hand.

Validated at scale: `scan` and `recommend` ran across all 92,861 real public TypeScript repositories with zero
crashes, and the full `init`/`wire`/`eject` round-trip ran clean on a 2,000-repo stratified sample. A companion
benchmark, [AgentRuleBench](https://github.com/Tommkruix/agentrulebench), measures the guidance-vs-enforcement
question directly (a pre-registered, honest null result on the boundary it tested).

**What auto-enforces vs. what you review.** Archprint is honest about which of its inferences it will stand
behind unattended. An adversarial correctness audit (three rounds over four real repositories) found that the
_mechanical_ families, ones grounded in unambiguous signals (no cycles, production must not import tests, no
`console` in library code, no undeclared dependencies, deep-relative import style, public-API barrels, no
reaching into a dependency's internals, and the DB/UI-in-server-entry rule), had zero false positives every
round. So those auto-generate as enforcement. The _structural-inference_ families (layer and role boundaries,
UI/data separation, entry purity, server/client, feature-slice and app isolation) infer a "layer" or "role"
from paths, which can be wrong, so Archprint holds them for human review by default rather than silently
enforcing them. Nothing whose inferred layer or role could be wrong is written as enforcement without you
opting in.

> Status: published on npm and safe to try on your real repo. Every rule is review-gated by default,
> reversible in one command (`archprint eject`), and deterministic, and a rule archprint marks
> "enforce now" is checked to pass on your code before it says so. `scan` and `recommend` are stable;
> the structural families stay review-only while they are hardened. Versioning is 0.x: the CLI surface
> and rule-card format may still change before 1.0. The analysis is not experimental.

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
# and record what to adopt next in archprint.json
archprint init apps/web

# See the rules your repo already follows, with the evidence
archprint scan apps/web

# Write the auto-trusted (mechanical) rules to disk (rule files + tool configs).
# Structural-inference rules are held for review; add --include-structural to emit them too.
archprint generate apps/web --out archprint-rules

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
```

Re-running `generate` (or `init`) refreshes the files in `archprint-rules/` and removes any rule the
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
Archprint v0.2.0
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

| Detector                         | Rule it can infer                                                                                                    | Ships as |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------- |
| Forbidden imports (marker based) | A role (route handler, server entry) must not import a target (the DB client, the UI layer)                          | Auto     |
| Circular dependencies            | The module graph should stay acyclic (gated on how cycle free it already is)                                         | Auto     |
| Test isolation                   | Production (non-test) code must not import test or spec files                                                        | Auto     |
| Dependency hygiene               | Import third-party packages by their public entry, not a dependency's `src`/`internal` internals                     | Auto     |
| Dependency declaration           | Every imported third-party package must be declared in `package.json` (no phantom/transitive deps)                   | Auto     |
| Import style                     | Prefer workspace aliases over deep relative imports (`../../../`)                                                    | Auto     |
| Console isolation                | Library (non-CLI) code must not call `console.*`                                                                     | Auto     |
| Public API (barrel) boundaries   | Files outside a feature or package must import it through its `index` barrel, not deep import its internals          | Auto     |
| Layer boundaries                 | Files in one layer must not import another, inferred from the dominant dependency direction                          | Review   |
| Role layering                    | Semantic tiers keep their direction (a REPOSITORY must not import a SERVICE, a SERVICE must not import a CONTROLLER) | Review   |
| Entry purity                     | Framework entries (pages, routes, layouts) must not be imported by other first-party code                            | Review   |
| UI / data separation             | Reusable UI components must not import the DB/data layer directly                                                    | Review   |
| Server / client boundary         | A Next.js `"use client"` module must not import a `server-only` module                                               | Review   |
| Feature-slice isolation          | Sibling slices under a `features`/`modules`/`slices`/`domains` container must not import each other                  | Review   |
| App isolation                    | Sibling apps under an `apps`/`services` container must not import each other directly                                | Review   |
| Env access                       | Read `process.env` only in the config/env layer                                                                      | Review   |
| Workspace package API            | Import a monorepo workspace package by its name, not a deep path into its source                                     | Review   |
| Stories isolation                | Storybook `.stories` files must not be imported by other code                                                        | Review   |
| Orphan modules                   | Files nothing imports and that are not framework entries (dead code candidates)                                      | Report   |
| Transitive reachability          | A layer boundary that a plain import rule passes but that leaks through an intermediary layer                        | Report   |

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

`archprint generate` writes only for the linters your repo actually uses, it detects ESLint,
eslint-plugin-import, and dependency-cruiser and emits each rule for a tool you already run, so you are
not left with config for a tool you do not have. `--emit <eslint|dependency-cruiser|all>` forces the
format. The formats it can produce:

- **dependency-cruiser** `forbidden` rulesets (when dependency-cruiser is present): by default the
  mechanical boundaries (public-API deep-import, test-isolation, dependency-internals); the structural ones
  (layer, role-layering, feature-slice, app-isolation, entry-purity) are written only with
  `--include-structural`, after you review them
- **eslint-plugin-boundaries** element-types config, and **ESLint core** rules (`no-restricted-imports`) for
  import-style boundaries
- **ESLint rule files** for marker based patterns: a rule card (`.md`), the rule (`.ts`), and a passing and a
  failing fixture
- **A shareable ESLint preset**: one self-contained `eslint-preset.archprint.mjs` that inlines the inferred
  rules and needs only eslint, so you can commit it, publish it, or hand it to another repo and adopt the rules
  in one line
- **ts-arch tests** for the first-party boundaries (layer, role, UI/data), so the inferred architecture can run
  inside your existing Vitest or Jest suite
- **Mermaid** and **Graphviz DOT** of the layer dependency graph, so the inferred architecture is visible and
  its violations are marked
- **`ADOPTION.md`**, a plain-language summary of what is enforced now, what is held for review, and what is
  worth adopting, with the tool that enforces each rule (written by `init`, or `generate --readme`)

`generate --check` runs the generated ESLint rules against your repo and reports whether they pass, so you
can confirm before wiring.

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

| Command                         | What it does                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `archprint init [path]`         | Zero-config setup: detect the stack, enforce the rules the code already follows, and write `archprint.json` plus a plain-language `ADOPTION.md`. `--include-structural`, `--out <dir>`, `--fast`, `--force`.                                                                                                                                                                                                                       |
| `archprint scan [path]`         | Report the rules the repo already follows, with evidence. `--deep` resolves through barrels and aliases.                                                                                                                                                                                                                                                                                                                           |
| `archprint generate [path]`     | Write the auto-trusted mechanical rules for the linters your repo uses; structural rules held for review. `--emit <eslint\|dependency-cruiser\|all>` forces the format, `--only <family>` and `--rules <ids>` narrow the output, `--check` runs the generated rules against your repo, `--readme` writes `ADOPTION.md`, `--rule <id>` emits one reviewed rule. Also `--include-structural`, `--no-graph`, `--out <dir>`, `--fast`. |
| `archprint explain <id> [path]` | Show the gate breakdown for one rule, with a codeframe per exception plus how-to-fix, when-not-to-use, and how-to-enforce.                                                                                                                                                                                                                                                                                                         |
| `archprint recommend [path]`    | Recommend a rule set from the repo's evidence and detected stack (works on a fresh repo too); names the installed tool that will enforce each rule.                                                                                                                                                                                                                                                                                |
| `archprint wire`                | Reference the generated rules from the enforcement tools your repo uses (flat eslint config, `.dependency-cruiser.json`) via a managed, reversible reference. `--out <dir>`, `--dry-run`.                                                                                                                                                                                                                                          |
| `archprint eject`               | Remove archprint's generated files, its manifests, and any wired references. `--out <dir>`, `--dry-run`.                                                                                                                                                                                                                                                                                                                           |

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

Versioning is 0.x (pre-1.0): the CLI surface and rule-card format may still change between minor versions,
but the analysis is not experimental and the tool is safe to adopt (every rule is review-gated and reversible
via `archprint eject`). The engine (twenty detectors, the confidence gate, and emitters for ESLint, a shareable
preset, dependency-cruiser, ts-arch, and the layer graph) is in place and tested, and an adversarial
correctness audit (three rounds, four real repositories) drove the false-positive rate on auto-generated rules
to zero for the mechanical families, which is why those auto-enforce while the structural-inference families
are held for review.

Production-ready today: `scan` and `recommend` (insight), and auto-enforcement of the mechanical families,
with a self-consistency check at generate time, an `init` scaffolder for fresh repos, and framework coverage
across React, Angular, Vue, and Svelte. Still ahead: hardening the structural families toward auto-enforcement
(a real per-file role-confidence measure, layer-cohesion, role-classifier ordering).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The project lints, type checks, and tests itself; every change keeps
coverage above its thresholds and ships a changeset.

## License

[MIT](LICENSE)
