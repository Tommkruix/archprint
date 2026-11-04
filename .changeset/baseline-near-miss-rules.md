---
'archprint': minor
---

`archprint generate --rules <ids> --baseline` adopts the rules you name even when they fall short of the confidence gate, so a team with existing breaks can stop new ones now instead of waiting for a clean codebase. Every file that breaks a named rule today is recorded as an exception and listed. The rule's evidence in `.archprint/config.json` stays as measured. From then on the exceptions only shrink, and a later plain `generate` keeps the rule. Naming an already adopted rule with `--baseline` accepts its new breaks and lists them. A rule your code does not follow, with under 80% of the files it applies to keeping it, cannot be adopted this way, and `--baseline` needs `--rules`. A rule card written with `--expand` shows such a rule's measured status.
