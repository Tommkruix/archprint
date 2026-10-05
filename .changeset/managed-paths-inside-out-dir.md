---
'archprint': patch
---

archprint now deletes and writes only where it should. Before, `generate`, `init`, `eject` and `migrate` removed every path listed in `.archprint/config.json`, the outputs manifest, or an old `archprint.json`'s `rulesDir`, so an edited file could make them delete folders elsewhere in the repo or outside it.

- Only paths inside archprint's own folder are deleted, with symlinks resolved first. The old `archprint-rules/` folder is cleared file by file from its manifest and removed only when empty, so files you put there stay.
- If `.archprint` (or the old rules folder) is a symbolic link, archprint refuses to write or delete through it.
- Every file archprint writes stays inside its folder: a file there that is a symbolic link is replaced with a real file, never written through, and a linked subfolder pointing elsewhere is refused.
- The README, `.prettierignore`, `.npmignore` and the linter configs archprint edits are left alone when they link outside the repository.
- `archprint eject --out` must name a folder inside the repository, not the repository itself, and an `--out` inside the repository that a symbolic link redirects elsewhere is refused.
