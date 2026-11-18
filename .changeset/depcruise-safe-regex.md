---
'archprint': patch
---

dependency-cruiser no longer refuses the generated config. When it contained the dependency internals rule
(`no-dependency-internals`) or the framework entry rule (`no-import-framework-entry`), dependency-cruiser stopped with
"has an unsafe regular expression. Bailing out" and checked nothing, because those two rules used a pattern its safety
check rejects. They now use equivalent patterns that match the same files. Run `archprint generate` again to update an
existing `.archprint/dependency-cruiser.json`.
