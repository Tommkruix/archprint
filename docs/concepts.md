# Concepts

The mental model behind Archprint, enough to trust what it does and read its output.

## Inference, not authoring

Every other TypeScript architecture tool (dependency-cruiser, eslint-plugin-boundaries, Nx, Sheriff, ts-arch)
enforces rules you write by hand. Archprint **infers** candidate rules from your repository's real import graph
and **gates each one on statistical evidence** before proposing it. You review and adopt rules your codebase
already demonstrates, instead of authoring them from scratch.

It then emits into the existing tools' formats, so it complements your stack rather than replacing it.

## The confidence gate

A candidate rule (for example "request-entry files must not import the DB client") is measured against the
code: how many files in the governed role conform, how many break it, and how confident that ratio is given the
sample size. Each candidate lands in one of three states:

- **AUTO** — high confidence the rule genuinely holds. Emitted as enforcement.
- **SUGGEST** — the code mostly follows it, but the evidence is thinner or the role is less certain. Surfaced
  for you to review and adopt deliberately.
- **REJECT** — not followed consistently enough, or the rule governs nothing (vacuous). Not emitted.

The confidence number is a **Wilson score lower bound** on the true conformance rate, not the raw ratio. This
fuses the observed ratio with the sample size: 100% conformance over 4 files is not the same as 100% over 400.
AUTO requires the 95% lower bound to clear a high threshold (so a thin sample cannot auto-generate a rule even
at 100% observed), at most a few exception files, and enough confidence that the governed files really are the
role they are classified as. Everything is measured from the graph; nothing is estimated.

## Mechanical vs. structural families (what auto-enforces)

Archprint is deliberately honest about which inferences it will stand behind unattended. An adversarial
correctness audit (three rounds over four real repositories) split the rule families in two:

- **Mechanical families** rest on unambiguous signals (no import cycles, production must not import tests, no
  `console` in library code, no undeclared dependencies, import style, public-API barrels, no reaching into a
  dependency's internals, and the DB/UI-in-server-entry rules). These had **zero false positives every round**,
  so an AUTO result from them auto-generates as enforcement.
- **Structural families** infer a "layer" or "role" from file paths (layer and role boundaries, UI/data
  separation, entry purity, server/client, feature-slice and app isolation, env access, workspace-package,
  stories). A path can be misread, so these are **held for human review by default**, even at AUTO. Emit them
  only with `--include-structural`, after you have looked at the evidence.

Nothing whose inferred layer or role could be wrong is written as enforcement without you opting in. See
[rules.md](./rules.md) for the per-family breakdown.

## Fast vs. deep

- **Fast** (default for `scan`) extracts imports with the TypeScript parser and matches at the import-specifier
  level. It is quick and, for direct-import boundaries (the common case), gives the same answer as deep.
- **Deep** (default for `generate`, since generation is the commitment point) resolves through barrel files and
  workspace aliases with the type-aware resolver. Use it to catch a forbidden import that is hidden behind a
  barrel re-export.

`--deep` opts `scan` into full resolution; `--fast` opts `generate` out of it (with a warning to confirm with a
deep pass before enforcing).

## The generated output and the lifecycle

`generate` (and `init`) write into `archprint-rules/`:

- ESLint rule blocks and a plugin for the forbidden-import rules,
- a shareable, self-contained ESLint preset (`eslint-preset.archprint.mjs`) that inlines the rules and needs
  only eslint, so it can be committed, published, or shared and adopted in one line,
- dependency-cruiser forbidden-rule configs,
- ts-arch tests for the first-party boundaries (layer, role, UI/data), runnable in your existing test suite,
- a rule card, passing fixture, and failing fixture for each forbidden-import rule,
- an outputs manifest (`.archprint-outputs.json`) that records exactly what Archprint owns.

Re-running `generate` **cleans its previous outputs first**, so a rule the evidence no longer supports stops
being enforced instead of lingering. `wire` inserts a single managed, reversible reference into the enforcement
tools your repo already uses (a flat ESLint config, a `.dependency-cruiser.json`); `eject` removes the files and
every wired reference, restoring each config exactly. A generated rule also grandfathers the few known exception
files it was inferred from, so adopting it is green on your current code while new violations are still caught.

## Determinism

The same repository at the same Archprint version produces the same output: no randomness, sorted output, and
the analysis engine pinned to an exact version. This is what makes the generated rules reviewable in a diff and
the evidence reproducible.
