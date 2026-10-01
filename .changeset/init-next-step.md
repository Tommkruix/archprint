---
'archprint': patch
---

`archprint init` now ends with the right next step. It names the config file it actually wrote (`.archprint/config.json`) and tells you to run `archprint wire` to reference the generated rules from your linter config, instead of describing an older file layout.
