---
'archprint': patch
---

The rule that keeps request handlers away from the database client (AP-001) no longer adds a request handler that creates its own client to the list of modules it forbids importing. Such a handler is still reported as breaking the rule; it just no longer changes the rule's definition, so `archprint check` does not show AP-001 as changed when a pull request adds or removes one.
