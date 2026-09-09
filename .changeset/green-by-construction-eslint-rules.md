---
'archprint': patch
---

Generated ESLint rules now exempt the exact files your code already treats as exceptions, so a rule
that archprint says you "already follow" stays green when you wire it, instead of flagging code that
was there all along. Previously the emitted scope was fixed and could report the very files the
evidence had accepted (for example a single library module that legitimately logs). This covers the
console, environment-access, deep-relative-import, and workspace-package rules.
