---
'archprint': patch
---

The dead-code lists now follow modules loaded by a path computed at runtime: an `import()` or `require()` of a
template such as `` `./pages/${name}.tsx` ``, a path built with `path.join` or `path.resolve` from `__dirname` or
`import.meta.dirname` (directly, through a `const`, or through `pathToFileURL(...).href`), and the file
`new URL('./worker.ts', import.meta.url)` names. A part known only at runtime matches within one folder in a Vite
project, as Vite expands it (only for a path ending with a file extension, and not `` `./${name}.ext` `` in the
importing file's own folder), and across folders elsewhere, as webpack and Node.js can load any of them. A path that
is only such a part in the importing file's folder
or a folder above it, like `` `./${name}` ``, is not followed, so it does not hide the files around it.
``import(`./x`)`` with no
substitution now counts like `import('./x')`.
