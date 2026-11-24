---
'archprint': patch
---

The "shipped in a published package" list reads a `.tsx` file as built to `.jsx` when its tsconfig sets `"jsx": "preserve"`, as TypeScript builds it. Before, it looked for a `.js` file, so a package that packs only `.jsx` files had its components listed as dead code.
