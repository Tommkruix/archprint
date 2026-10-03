---
'archprint': patch
---

`generate --expand` now writes each forbidden-import rule's files from that rule. Before, the database rule (AP-001) got the UI rule's ESLint message, rule card text and fixtures, so its failing fixture imported a UI component that AP-001 never flags. Each rule's message now states the rule, its card lists what it forbids, and its failing fixture imports something the rule really reports: one of the repo's own exceptions when there is one, otherwise the database wrapper or component folder archprint found.
