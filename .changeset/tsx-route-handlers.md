---
'archprint': patch
---

Classify `.tsx` route handlers and `pages/api` files as request entries. Route handlers can legitimately use
JSX (for example `next/og` `ImageResponse` routes), and matching only `.ts` misclassified those as UI
components, hiding request-entry boundary violations in them.
