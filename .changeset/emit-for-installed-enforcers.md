---
'archprint': minor
---

archprint now generates rules for the enforcers your repo actually uses. It detects whether you have
ESLint or dependency-cruiser and emits each rule for a tool you already run, instead of writing
dependency-cruiser configs you have no way to enforce. On an ESLint-only repo it expresses test
isolation as an ESLint `no-restricted-imports` rule; dependency-cruiser configs are only written when
dependency-cruiser is present. `archprint recommend` now names, per rule, the installed tool that will
enforce it (or what you would need to install).
