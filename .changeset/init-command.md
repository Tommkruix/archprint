---
'archprint': minor
---

Add `archprint init` (roadmap B1): a single zero-config onboarding command. It detects the repo's stack, scans
the import graph, writes enforcement configs for the rules the code already follows (mechanical families by
default, `--include-structural` to add the review-tier families), and records an `archprint.json` manifest with
the three census-backed recommendation tiers (enforce now / review / adopt) so the setup is reproducible and
inspectable. It refuses to overwrite an existing manifest without `--force`, runs the self-consistency guardrail
before writing, and prints a friendly summary with next steps. The writer orchestration shared with `generate`
was extracted into a single `writeEnforcementConfigs` helper so the mechanical/structural partition lives in one
place.
