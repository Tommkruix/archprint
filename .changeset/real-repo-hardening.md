---
'archprint': patch
---

Hardening from wiring archprint into a real ESLint-only Next.js monorepo:

- `wire` now parses the ESLint config with the TypeScript AST instead of regex, so it is not fooled
  by `export default` appearing inside a string or comment and reliably splices into
  `const config = [...]; export default config;`.
- Rule configs for a tool the repo does not use are no longer written to disk at all (previously an
  ESLint-only repo could get an orphaned, untracked `dependency-cruiser.*.json`). Use `--emit all` to
  force every format regardless of detected tooling.
- The wired ESLint config and shareable preset ignore archprint's own generated `.archprint.mjs`
  files, so linting your repo no longer flags archprint's output.
- `archprint generate --check` reports only violations of the rules archprint generated, ignoring a
  repo's inline `eslint-disable` comments that reference other plugins' rules.
