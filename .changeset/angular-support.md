---
'archprint': minor
---

Add Angular support. Archprint now detects Angular in a repository's stack and classifies Angular UI files
(`.component.ts`, `.directive.ts`) as components, so the component-aware rules (such as UI/data separation)
apply to Angular codebases, not just React/`.tsx`. The UI/data rule now covers every component file type it
recognizes, rather than only the first.
