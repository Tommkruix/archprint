---
'archprint': patch
---

`archprint scan` now surfaces circular-dependency detection: it lists the import cycles it finds, or, when
the repo is cycle-free, reports that the "no circular dependencies" rule is enforceable. Cycle detection runs
in fast mode (the structural graph is faithful without the type checker), so it does not slow a `--deep` scan.
