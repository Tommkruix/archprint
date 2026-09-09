---
'archprint': minor
---

archprint now generates rules for the enforcers your repo actually uses. It detects whether you have
ESLint, eslint-plugin-import, or dependency-cruiser and emits each rule for a tool you already run,
instead of writing dependency-cruiser configs you have no way to enforce. On an ESLint-only repo it
expresses test isolation as an ESLint `no-restricted-imports` rule, and phantom (undeclared) imports
via `eslint-plugin-import` when that plugin is installed. dependency-cruiser configs are only written
when dependency-cruiser is present.
