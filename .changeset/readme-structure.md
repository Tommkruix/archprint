---
'archprint': patch
---

The README is reorganised so anyone can follow it: a plain-words explanation of what Archprint does and who it is for, the demo recordings and a "try it in your browser" link up front, a section on using it with AI coding agents (with the measured comparison), a short quick start, and a plain explanation of how it decides which rules to trust before the reference material. It also corrects the list of rule families that turn on automatically: dependency declaration is held for review, as the detector table and `init` already said. Circular dependencies are now described as reported rather than enforced, since no lint rule is written for them yet, and the README states precisely what makes generated rules green on your code and what `generate --check` adds.
