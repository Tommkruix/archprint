---
'archprint': patch
---

Fix the env-access detector's confidence gate, which could never reach AUTO. It gated on the count of files
that read `process.env`, but a repo that centralizes env access reads it in only a handful of config files, so
the population was always far below the Wilson floor. It now gates on the non-config files the rule governs
(the population), with violations being non-config files that read `process.env` directly, mirroring the
console-isolation detector. A full 92,861-repo census surfaced the bug: env-access was AUTO on 0% of apps.
