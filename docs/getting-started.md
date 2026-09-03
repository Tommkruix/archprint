# Getting started

Archprint mines the architecture rules your repo already follows, gates them on evidence, and emits them into
the tools you already use.

## Install

Until it is on npm, build from source:

```bash
git clone https://github.com/Tommkruix/archprint
cd archprint
npm ci
npm run build
node dist/cli.js scan <path-to-your-app>
```

Requires Node >= 20. Point Archprint at a directory that has a `tsconfig.json` (for a monorepo, a package such
as `apps/web`; a monorepo root works too, Archprint discovers the app directories and respects `.gitignore`).

## The 60-second path

```bash
# One command: detect the stack, enforce the rules your code already follows,
# and record what to adopt next in archprint.json
archprint init apps/web
```

`init` scans the repo, writes the auto-trusted (mechanical) rules into `archprint-rules/`, and prints three
tiers: what is enforced now, what to review before enforcing, and what comparable repos commonly adopt that you
do not yet. Then reference the generated rules from your linter:

```bash
archprint wire      # inserts a managed, reversible reference into your eslint / dependency-cruiser config
```

Run your linter (eslint, dependency-cruiser) as usual and the archprint rules are in effect. To undo everything:

```bash
archprint eject     # removes the generated files and every wired reference, restoring your configs exactly
```

## The deliberate path

If you would rather inspect before you enforce:

```bash
# See the rules your repo already follows, with the evidence
archprint scan apps/web

# Drill into one rule: gate breakdown, offending lines, how to fix, when not to use it
archprint explain AP-002 apps/web

# Write the auto-trusted mechanical rules (structural ones are held for review)
archprint generate apps/web

# Emit one specific rule after reviewing it (including a SUGGEST rule)
archprint generate apps/web --rule AP-001

# Also emit the structural-inference families (review these first)
archprint generate apps/web --include-structural
```

`generate` re-cleans its own previous output each run, so the generated rules never drift from the current code.

## For a fresh or thin repo

```bash
archprint recommend apps/web
```

`recommend` works even with little code to learn from: it sorts every rule family into enforce-now / review /
adopt-from-day-one, and the adopt tier is backed by a census of tens of thousands of public TypeScript repos
(stack-aware), not hand-picked defaults.

## CI

`scan --json` and `recommend --json` emit stable, version-keyed JSON for scripting. Exit codes are the
contract: `0` on success, `1` on error.

## Next

- [Concepts](./concepts.md) — the confidence gate, mechanical vs. structural, fast vs. deep, the lifecycle.
- [Rules](./rules.md) — every rule family: what it detects, its evidence, and when not to use it.
