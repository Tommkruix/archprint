---
'archprint': minor
---

Broaden framework role coverage in the classifier so the existing rules apply beyond Next.js and NestJS:
SvelteKit (`+server.ts` endpoints, `+page.server.ts`/`+layout.server.ts` server loads, `hooks.server.ts`,
and `+page.ts`/`+layout.ts` universal loads), Nuxt Nitro handlers (`server/api|routes|middleware|plugins`),
and Remix / React Router file-based routes (`app/routes/**`, `root`, `entry.server`/`entry.client`).

`ROLE_PATTERNS` now maps each role to all of its path patterns rather than one, and the rule generator embeds
every pattern per role. Previously a role matched by more than one rule would have collapsed to a single
pattern in generated rules; with the new multi-framework rules this would have dropped variants.
