---
'archprint': patch
---

A file a vitest, jest or playwright config names in `setupFiles`, `setupFilesAfterEnv`, `globalSetup` or
`globalTeardown` (the `jest` field of package.json included), such as `vitest.setup.ts` or `jest.setup.ts`, now counts
as a test file. Before, it counted as production code: test isolation recorded it as an exception for importing test
helpers, other rules counted its imports and `console` calls, and dead code could list it as unused. The generated
ESLint and dependency-cruiser rules skip it like any other test file, and a module only it imports, such as a mock
server, is listed as imported only by tests. Where a setup file was a recorded exception, `generate --check` reports
the change until you run `archprint generate` again.
