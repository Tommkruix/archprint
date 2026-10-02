---
'archprint': patch
---

Scanning now skips the same files git does for `.gitignore` patterns where a wildcard has to reach past a partial match, such as `f*o/*/*` matching `foo/b/c`. Before, a few such patterns failed to match and those files were scanned. Scan output is unchanged on the large repositories we checked.
