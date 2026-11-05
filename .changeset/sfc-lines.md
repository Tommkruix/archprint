---
'archprint': patch
---

`archprint check` now points at the right line in Vue and Svelte files. Lines were counted from the start of the `<script>` block rather than the file, so an annotation on a `.vue` or `.svelte` file landed above the import that broke the rule.
