---
'archprint': patch
---

The generated dependency-cruiser rules now exempt exactly the files a rule tolerates. Earlier, an exemption matched any path ending the same way, so in a monorepo the exempted `src/lib/legacy.ts` of `apps/web` also silenced a new break at `apps/api/src/lib/legacy.ts` when dependency-cruiser checked both apps, and within one app it also exempted, say, `src/lib/legacy.ts` when only `lib/legacy.ts` was meant. An exemption still applies whether dependency-cruiser runs from the repository root or inside the app. Run `archprint generate` to refresh `.archprint/dependency-cruiser.json`.
