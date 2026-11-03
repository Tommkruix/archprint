---
'archprint': minor
---

`archprint init` no longer edits your `README.md` unless you pass `--readme`, the same flag `generate` takes. The README section it writes now lists each adopted rule with this repo's evidence (for example "`AP-001`: A request handler must not import the database client directly (45 of 45 files it applies to follow it)"), plus what your code follows that no rule enforces and what is held for review. It no longer carries the "% of comparable repos" figures or the "Worth adopting" list; those stay in the terminal output and in `archprint recommend`. `init` now ends by listing every file it wrote or changed.
