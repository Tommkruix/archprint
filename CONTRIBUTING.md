# Contributing to Archprint

Thanks for your interest. Archprint is a deterministic analysis tool, so correctness and reproducibility come
first: identical input plus version must always produce identical output.

## Development setup

```bash
git clone https://github.com/Tommkruix/archprint
cd archprint
nvm use            # Node is pinned in .nvmrc (>= 20)
npm ci
npm run build
```

Useful scripts:

| Script                  | What it does                             |
| ----------------------- | ---------------------------------------- |
| `npm run build`         | Compile to `dist/`                       |
| `npm run typecheck`     | `tsc --noEmit`                           |
| `npm run lint`          | ESLint                                   |
| `npm test`              | Vitest (run once)                        |
| `npm run test:coverage` | Vitest with coverage thresholds enforced |
| `npm run format`        | Prettier write                           |

## Coding standards

- TypeScript in `strict` mode, ESM modules.
- Use `ts-morph` for AST work. Never regex parse TypeScript source.
- Small, single responsibility modules. Keep the analysis core pure; isolate side effects (fs, CLI,
  `process.exit`) at the edges.
- DRY with a single source of truth. Descriptive names. No dead code, no magic values.
- Comments explain **why**, not what. Remove anything that only restates the code.

## Tests

- Every detector and the confidence gate has unit tests with fixtures under `tests/`.
- Fixtures live in `tests/fixtures/` (each with its own `tsconfig.json` when it needs aliases) and are
  excluded from test collection.
- Coverage thresholds are a ratchet: keep them green and do not lower them. Cover new logic with meaningful
  tests; reserve `v8 ignore` for genuinely defensive or unreachable branches, each with a stated reason.
- Generated ESLint rules are tested with ESLint's `RuleTester` (valid and invalid cases).

## Commits and changesets

- Follow [Conventional Commits](https://www.conventionalcommits.org/) (`type(scope): summary`), for example
  `feat(detector): infer public-API boundaries`.
- Every meaningful change includes a changeset: `npx changeset`. Do not hand edit versions or the changelog.

## Pull requests

Open a PR against `develop`. CI must pass: format check, lint, typecheck, tests with coverage, and build. Keep
PRs focused and describe the evidence behind any behavior change.

## Conservative bias

One wrong rule hurts credibility more than zero rules. When a detector or gate change is a judgment call,
prefer the option that avoids proposing a rule the evidence does not fully support.
