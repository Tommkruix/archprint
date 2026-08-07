---
'archprint': patch
---

Fix catastrophic backtracking (ReDoS) in the "use server" directive check.

`hasUseServerDirective` used a regex with nested quantifiers over overlapping whitespace/comments, which
backtracks exponentially: a file whose first bytes contain ~20+ comment tokens took ~6s, and more hung the
scan indefinitely (a real hang on `archprint scan` for repos with heavily-commented or generated leading
files). It now scans the head linearly (skipping whitespace, line comments, and block comments) with only a
fixed-literal final check, so the worst case is linear. Behavior is unchanged for real inputs; a
comment-heavy head that took seconds now takes microseconds.
