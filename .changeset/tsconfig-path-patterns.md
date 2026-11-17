---
'archprint': patch
---

tsconfig `paths` now resolve the way TypeScript resolves them. A `*` in the middle of a target, as in the monorepo
mapping `"@vue/*": ["./packages/*/src"]`, takes the matched name; before, such an import resolved to a path that
does not exist, so the dead-code check, layer boundaries and declared rules missed it. A key's later targets are
tried when the first names no file, the key with the longest matching prefix wins, and an import whose targets all
miss resolves as the workspace package of that name.
