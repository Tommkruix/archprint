---
'archprint': minor
---

Archprint now writes a minimal `.archprint/` directory instead of a folder of per-family files. `generate` and `init` emit one self-contained rules file per linter you actually use (`.archprint/eslint.mjs` and/or `.archprint/dependency-cruiser.json`) plus a `.archprint/config.json` that records what is enforced and what Archprint manages. The plain-language summary that used to be `ADOPTION.md` is now a managed section in your `README.md`, and a managed `.prettierignore` entry keeps the generated files out of your formatter.

- `--expand` writes the granular artifacts (per-family configs, per-rule cards and fixtures, the eslint-plugin, ts-arch tests, and the layer graph) inside `.archprint/` for anyone who wants to inspect or vendor individual rules.
- New `archprint migrate` (alias `upgrade`) moves an older `archprint-rules/` setup to the new layout and rewrites the reference in your linter config in place, writing the new files before removing the old ones so the config never points at a deleted file. `generate` and `init` stop and point you to it if they detect the old layout.
- `wire` imports the single rules file with an ESM-safe relative specifier, and `eject` removes the files, the config, the managed README section, and every wired reference.
