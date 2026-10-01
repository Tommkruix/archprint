---
'archprint': patch
---

`archprint eject` now restores an ESLint config exactly when its array starts on the same line as its first entry (for example `export default [{ ignores: ['dist/'] }, ...]`). `wire` used to break that line to insert its reference, and `eject` left the line break behind. `wire` now inserts the reference inline on that line, and `eject` removes exactly what it added. Configs with a multi-line array are unchanged.
