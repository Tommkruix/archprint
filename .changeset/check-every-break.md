---
'archprint': patch
---

`archprint check` now catches a file that breaks a rule more times than it did on the base branch for every rule
family, a recorded exception included. Before, request-handler rules (AP-001, AP-002), layer and role boundaries,
console and `process.env` rules counted at most one break per file, so a second break in a file that already had one
went unreported, and a second file importing a story that another file already imported was never reported at all.
Console and `process.env` findings now show their line.
