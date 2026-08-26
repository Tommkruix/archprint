---
'archprint': patch
---

Fix `detectLayerBoundaries` and `detectCycles` returning empty or incorrect results when called with a
relative `appDir`. They now normalize the directory to an absolute path, so import edges resolve consistently
whether an absolute or relative directory is passed. (The CLI already passed absolute paths and was
unaffected.)
