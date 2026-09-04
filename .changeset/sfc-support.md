---
'archprint': minor
---

Scan Vue and Svelte single-file components. Archprint now reads the `<script>` block of `.vue` and `.svelte`
files, treats them as UI components, and follows their imports, so the component-aware rules (such as UI/data
separation) apply to Vue and Svelte projects.
