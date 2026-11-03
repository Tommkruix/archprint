---
'archprint': minor
---

`archprint explain`, the `archprint_explain` MCP tool and `archprint allow` now accept a rule by any of its names: its id (`no-lib-to-components`, the one `generate --rules` takes), its label (`lib !-> components`), or its ESLint name (`archprint/no-lib-to-components`), in any case and spacing. `generate --rules` accepts the ESLint name too. Earlier, `archprint_explain` took only the label and `archprint explain` only the forbidden-import (AP-) ids, so the name ESLint printed was rejected. `archprint explain` now explains every rule `scan` lists, with its evidence, the files that break it and how to adopt it. Each rule in `scan --json` and `archprint_scan` now carries its `id`.
