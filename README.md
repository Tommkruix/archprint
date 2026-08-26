# Archprint

**Mine the architecture rules your repo already enforces, with the evidence attached.**

Archprint scans a TypeScript repository's real import graph, finds the architectural boundaries the code
already respects, and turns the ones that pass a statistical confidence gate into deterministic, ready to
install lint rules. Every rule ships with the evidence behind it: how many files conform, how many break it,
and how confident the inference is.

Your `CLAUDE.md` is guidance. Your lint rules are enforcement. Archprint closes the gap by generating the
enforcement from patterns your codebase already demonstrates, so you adopt rules you can trust instead of
authoring them by hand.

> Status: `0.1.0`, pre-stable (0.x may break between minor versions). Not yet published to npm.

## What makes it different

Established TypeScript tools (dependency-cruiser, eslint-plugin-boundaries, Nx, Sheriff, ts-arch) all
**enforce** architecture rules you write by hand. Archprint **infers** them from the actual import graph and
**gates each one on statistical evidence** before proposing it. Across the TypeScript ecosystem, no other tool
does either (see the comparison below). It then emits into those existing tools' formats, so it complements
your stack rather than replacing it.

## Install

Not yet on npm. For now, build from source:

```bash
git clone https://github.com/Tommkruix/archprint
cd archprint
npm ci
npm run build
node dist/cli.js scan <path-to-your-app>
```

Once published, it will install as a normal dev dependency:

```bash
npm install --save-dev archprint
npx archprint scan .
```

Requires Node >= 20. Point Archprint at an app directory that has a `tsconfig.json` (for a monorepo, a
package such as `apps/web`; a monorepo root is fine too, Archprint discovers the app directories).

## Quick start

```bash
# See the rules your repo already follows, with the evidence
archprint scan apps/web

# Write the enforceable ones to disk (rule files + tool configs)
archprint generate apps/web --out archprint-rules

# Inspect the gate evidence behind one rule
archprint explain AP-002 apps/web

# Generate a provisional (SUGGEST) rule after reviewing it
archprint approve AP-001 apps/web
```

## Example

A real scan of [inbox-zero](https://github.com/elie222/inbox-zero) (`apps/web`, 2,232 TypeScript files),
trimmed:

```
Archprint v0.1.0
Scanned 2,232 TypeScript files
Workspace aliases: 3 resolved

GENERATED RULES
  AP-002  no-ui-layer-in-server-entry      confidence 97%
          Evidence: 216/217 role files conform (99.5% observed)
          Exceptions: 1

LAYER BOUNDARIES (enforceable)
  utils !-> api  layer boundary   confidence 99%
          Evidence: 655/655 utils files conform (100%); 186 api file(s) depend on utils
  utils !-> components  layer boundary   confidence 99%
          Evidence: 652/655 utils files conform (99.5%); 164 components file(s) depend on utils
          Exceptions: 3
          Transitive leak: utils reaches components through another layer (needs a reachability rule).
```

Every number is measured from the import graph, not estimated.

## What Archprint detects

| Detector                         | Rule it can infer                                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Forbidden imports (marker based) | A role (route handler, server entry) must not import a target (the DB client, the UI layer)                    |
| Layer boundaries                 | Files in one layer must not import another, inferred from the dominant dependency direction                    |
| Circular dependencies            | The module graph should stay acyclic (gated on how cycle free it already is)                                   |
| Orphan modules                   | Files nothing imports and that are not framework entries (dead code candidates, reported, never auto enforced) |
| Transitive reachability          | A layer boundary that a plain import rule passes but that leaks through an intermediary layer                  |
| Public API (barrel) boundaries   | Files outside a feature or package must import it through its `index` barrel, not deep import its internals    |
| Feature-slice isolation          | Sibling slices under a `features`/`modules`/`slices`/`domains` container must not import each other            |

## The confidence gate

Archprint never proposes a rule as enforceable on a thin sample. Each candidate is scored with a **Wilson
score lower bound** on its true conformance rate, which fuses the observed ratio and the sample size into one
number, so 5 of 5 clean files is not treated as evidence of a 90% rule but 40 of 40 is.

- **AUTO** (enforceable): the 95% lower bound on conformance is at least 90%, with at most 3 exceptions and a
  confidently classified role.
- **SUGGEST** (provisional): the pattern looks like a rule (at least 80% observed) but the sample is too thin
  to be confident. Surfaced for review, not auto generated.
- **REJECT**: not enough signal.

The bias is deliberate and conservative: one wrong rule hurts credibility more than zero rules.

## Output formats

`archprint generate` writes into the formats your existing tools already read:

- **dependency-cruiser** `forbidden` rulesets (layer boundaries, public-API deep-import rules, and
  feature-slice cross-slice rules)
- **eslint-plugin-boundaries** element-types config
- **ESLint rule files** for marker based patterns: a rule card (`.md`), the rule (`.ts`), and a passing and a
  failing fixture
- **Mermaid** and **Graphviz DOT** of the layer dependency graph, so the inferred architecture is visible and
  its violations are marked

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

| Command                         | What it does                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `archprint scan [path]`         | Report the rules the repo already follows, with evidence. `--deep` resolves through barrels and aliases. |
| `archprint generate [path]`     | Write the enforceable (AUTO) rules and tool configs. `--out <dir>`, `--fast`.                            |
| `archprint explain <id> [path]` | Show the full gate breakdown for one rule id.                                                            |
| `archprint approve <id> [path]` | Generate a provisional (SUGGEST) rule after you review it.                                               |

## Fast and deep modes

`scan` defaults to a **fast** specifier level pass (no type checker). `generate` and `approve` default to a
**deep** pass that resolves through barrels and workspace aliases, since generation is the commitment point.
Structural analysis (cycles, orphans, reachability, public-API) always uses the fast graph: it is faithful to
deep resolution for those, and public-API detection in fact requires it (deep resolution would resolve through
a barrel and erase the barrel-versus-deep signal).

## Determinism

Same repo plus same version produces the same output. Analysis is pure and sorted; there is no randomness.

## Status and roadmap

`0.1.0`, pre-stable. The engine (seven detectors, four output formats, the confidence gate) is in place and
tested. Still ahead: broader framework role coverage, more rule families, and the companion benchmark
(AgentRuleBench) measuring whether installing an inferred rule makes an AI coding agent self correct.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The project lints, type checks, and tests itself; every change keeps
coverage above its thresholds and ships a changeset.

## License

[MIT](LICENSE)
