---
'archprint': patch
---

The orphan list no longer reports the files a Vite app starts from. In a folder with a Vite config, the module scripts
of `index.html` in the Vite root and of each HTML build input (`build.rollupOptions.input`,
`build.rolldownOptions.input`) are entries: a `<script type="module">` tag's `src` and the path imports of an inline
module script. A `/` path is read from the Vite root (`root` when written as a path) unless the file is in
`publicDir`; classic scripts, `vite-ignore` scripts and URLs are not counted. Paths in a config can now also be
written as `resolve(__dirname, ...)` with `resolve` imported by name, `__dirname` itself, or
`fileURLToPath(new URL('./x', import.meta.url))`, which computed `import()` paths follow too.
