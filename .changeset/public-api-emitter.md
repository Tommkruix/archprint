---
'archprint': minor
---

Generate an enforceable rule from public-API boundaries. `archprint generate` now writes
`dependency-cruiser.public-api.archprint.json`: one `forbidden` deep-import rule per AUTO barrel group, where
a module outside `<dir>` may not import any file inside it except the barrel. Completes the public-API rule
family (detect plus emit), alongside the existing dependency-cruiser and eslint-plugin-boundaries layer
outputs.
