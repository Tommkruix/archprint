---
'archprint': patch
---

A tsconfig whose `paths` holds an entry TypeScript rejects (substitutions that are not an array of strings, such as
`"@x": "./src"`) no longer stops the scan; such entries are skipped, as TypeScript reports them as errors.
