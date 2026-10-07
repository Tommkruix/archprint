---
'archprint': patch
---

Files in folders whose names glob patterns read as syntax, such as Next.js `[id]`, `[...slug]`, `(group)` and `@slot` route folders, now work everywhere. `archprint allow` accepts them, and `archprint check` no longer stops with "must be a file path relative to the app" afterwards. The ESLint rules exempt exactly that file: before, a path like `app/[id]/page.tsx` could exempt the wrong file (`app/i/page.tsx`) and keep flagging the right one. An allowed exception must still name one file; `*` and `?` are refused.

Two related fixes: an exception to an `AP-` rule no longer also exempts a file in another folder whose path merely ends the same way, and the review-held env-access and workspace-package rules now exempt their existing exceptions when the ESLint config sits at the repository root of a monorepo.
