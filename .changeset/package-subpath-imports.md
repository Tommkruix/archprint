---
'archprint': patch
---

Follow `#` imports (the `imports` field of package.json, such as `"#hooks/*": "./src/hooks/*.ts"`) when listing orphans and test-only files and when checking your written rules. Before, a file reached only through a `#` import was listed as an orphan, and a written rule that forbids importing it missed the import. A `#` import resolves through the package.json nearest to the importing file, as in Node.js, and a tsconfig alias of the same name still wins, as in TypeScript.
