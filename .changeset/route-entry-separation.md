---
'archprint': patch
---

Classify Next.js App Router entry files as route entries, not reusable components.

`page.tsx`, `layout.tsx`, `template.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `default.tsx`, and
`global-error.tsx` under `app/` render UI but are framework entry points, not part of the shared UI layer.
Classifying them as a distinct `ROUTE_ENTRY` role keeps them out of the component count during UI-layer
inference, so a page-heavy feature area is no longer mistaken for the UI layer. No marker change on
inbox-zero, dub, formbricks, or cal.com.
