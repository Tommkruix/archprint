---
'archprint': patch
---

When a file breaks a rule more times than on the base branch (another `console` call, another `fetch`), `archprint check` now lists only the break on the line the change added, instead of every break of that kind in the file. When the diff cannot tell them apart, because the change also edited an old one or moved code, it still lists every one.
