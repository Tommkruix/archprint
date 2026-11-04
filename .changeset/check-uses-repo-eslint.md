---
'archprint': minor
---

`generate --check` now runs through your repo's own ESLint. It used the copy of ESLint that came with archprint, which `npx archprint` does not install, so under `npx` it failed with "Cannot find package 'eslint'". It now loads ESLint from your repo (version 9 or later) and exits with code 2 and a clear message when there is none. Once the rules are wired, it lints through your ESLint config, the one your editor and CI run, instead of the generated rules on their own, and names any generated rule that config turns off, downgrades to a warning or overrides for some files, with an example file. If your ESLint config fails to load, the check stops with exit code 2 and the error instead of passing. Before wiring, it checks the generated rules on their own, says so, and uses your repo's TypeScript parser.
