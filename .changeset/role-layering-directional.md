---
'archprint': patch
---

More accurate role-layering inference. A role boundary (for example, a repository must not import a service) is
now trusted for auto-enforcement only when both the file roles are confidently classified and the direction is
strongly evidenced. Boundaries whose direction rests on just a couple of imports, where it could be a coin flip,
are held for review instead.
