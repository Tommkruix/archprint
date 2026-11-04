---
'archprint': patch
---

`archprint check` now gives console-isolation and env-access findings a line number: the line of the first `console.*` call or `process.env` read in the file. Earlier, those findings carried no line, so `--format github` annotated the whole file instead of the line.
