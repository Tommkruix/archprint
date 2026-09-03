---
'archprint': minor
---

Add the generated-output lifecycle (roadmap B6, part 1). Archprint now records everything it writes into an
`.archprint-outputs.json` manifest in the output directory, so it owns a precise, safe list of its own files.
`generate` and `init` now clean their previous outputs before writing fresh ones, so a rule the evidence no
longer supports stops being enforced instead of lingering as a stale file (upholds the conservative-bias
principle). A new `archprint eject` command removes archprint's generated files and its config manifests cleanly
(`--dry-run` to preview), giving a clean uninstall. The clean step only ever touches paths archprint recorded
as its own, and refuses to delete anything outside the output directory.
