---
'archprint': patch
---

- `wire` parses your ESLint config with the TypeScript AST, so it reliably edits the common
  `const config = [...]; export default config;` shape and is not fooled by `export default` appearing
  inside a string or comment.
- archprint no longer writes rule files for a tool your repo does not use; pass `--emit all` to force
  every format.
- The wired ESLint config and the shareable preset ignore archprint's own generated files, so linting
  your repo never flags them.
- `archprint generate --check` reports only violations of the rules archprint generated.
