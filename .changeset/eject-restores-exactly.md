---
'archprint': patch
---

`archprint eject` now restores `README.md`, `.prettierignore` and `.npmignore` byte for byte. Before, a file without a final newline, with several trailing newlines, or with mixed line endings came back slightly different after archprint added and then removed its section.
