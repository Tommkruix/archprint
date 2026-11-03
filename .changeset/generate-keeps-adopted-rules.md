---
'archprint': minor
---

`archprint generate` now keeps the rules you adopted on every run, not only with `--only` or `--rules`. Earlier, a plain run (including `generate --check`) reset `.archprint/` to the default rule set, so rules you had adopted with `--rules`, such as layer boundaries, disappeared without a word. A plain run now refreshes the adopted rules alongside the defaults and says which it kept. To start again from the default set, pass the new `--reset` flag: it lists every adopted rule it removes. `init --force` does the same. `generate --check` on its own now checks the rules already in `.archprint/` and writes nothing; with other flags it generates first, as before.
