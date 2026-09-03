---
'archprint': patch
---

Speed up fast-mode scanning about 2.6x (roadmap C1/C2). Fast mode now extracts imports with the raw TypeScript
parser instead of ts-morph's heavier wrapper layer (same AST fidelity, no regex parsing), and caches each file's
parse by path + mtime + size so the many detectors that scan the same files reuse one parse instead of
re-parsing. On inbox-zero (2,232 files) a fast scan drops from ~13.5s to ~5.2s. Output is unchanged: the
per-family gate distribution is identical across the five-repo regression corpus, and all tests pass. Deep mode
(full barrel/alias resolution via ts-morph) is unaffected.
