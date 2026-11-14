---
'archprint': patch
---

Fix a crash on monorepos whose packages use a solution-style `tsconfig.json` (`"include": []` with `references`) that also sets `outDir`. `archprint scan` and the other orphan-reading commands stopped with "Cannot read properties of undefined (reading '0')"; such a config now counts as building nothing, and its referenced configs are read as before.
