---
'archprint': minor
---

Fix two scanning bugs found by running archprint on itself. (1) Respect `.gitignore`: the walker and app-dir
discovery now skip git-ignored paths (via the standard `ignore` matcher) in addition to the always-noise
directories, so a scan no longer descends into vendored repos or other large ignored trees and hang. (2) Resolve
ESM `.js` specifiers to their `.ts` source: `import './x.js'` where the file is `x.ts` (the NodeNext/ESM
convention, which archprint's own code uses) now resolves, so first-party edges are found on ESM TypeScript
projects instead of every file looking like an orphan. The three duplicated import resolvers were unified into
one `resolveFirstPartyImport`. Verified against the five-repo regression corpus (unchanged) and by dogfooding
this repo (false orphans dropped from 66 to 1, the real CLI entry).
