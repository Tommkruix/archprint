---
'archprint': minor
---

Add public-API (barrel) boundary detection. A directory holding an `index.ts`/`index.tsx` exposes a public
API; `detectPublicApiBoundaries` classifies every external consumer against the nearest enclosing barrel (an
import of the barrel conforms, an import of any other file in the group is a deep-import violation) and runs
the count through the Wilson gate, so "files outside `<dir>` must import it through its barrel" becomes
enforceable (AUTO), provisional (SUGGEST), or unsupported. Surfaced in the scan report. Uses the fast import
graph deliberately: deep resolution would resolve through the barrel and erase the barrel-vs-deep signal.
