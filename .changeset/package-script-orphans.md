---
'archprint': patch
---

`scan` no longer lists a file a package.json script runs as an orphan. When a script starts a JavaScript runtime (`node`, `tsx`, `ts-node`, `bun`, `deno` and similar, behind `npx`, `pnpm exec`, `cross-env` or environment variables), the file it runs and the modules or config its `--require`, `--import`, `--loader` or `--config` flags name are entries, as knip reads scripts; a built path such as `node dist/server.js` counts for its source file. Other tools' arguments, such as a lint or format glob, are not.
