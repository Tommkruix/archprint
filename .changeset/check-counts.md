---
'archprint': patch
---

`archprint check` now counts the breaks of each rule in a file, the way ESLint's bulk suppressions do, with the base branch as the baseline. Earlier, a file that already broke a rule could break it again in a pull request unnoticed, as long as the new break looked like the old one (the same rule and the same import or global). Now, when a file breaks a rule more times than it did on the base, `check` reports it and lists every break of that rule in the file, since which one is new cannot be told; fewer than on the base counts as fixed.
