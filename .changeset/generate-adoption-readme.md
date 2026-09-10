---
'archprint': minor
---

`archprint generate --readme` writes an `ADOPTION.md` in the output directory summarizing what is
enforced now, held for review, and worth adopting, each with the tool that enforces it. It is tracked
in the manifest, so `archprint eject` removes it too.
