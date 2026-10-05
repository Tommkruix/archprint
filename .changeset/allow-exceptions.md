---
'archprint': minor
---

New `archprint allow <rule> <file> --reason "..."` records a justified exception to an adopted rule in `.archprint/allow.json`. `archprint check` (and the GitHub Action and the MCP `archprint_check` tool) no longer counts an allowed exception as a new violation, lists every exception added in the pull request with its reason, and points out exceptions the code no longer needs. The next `archprint generate` stops ESLint flagging the allowed file for that rule. When `init` or `generate` re-infers the rules, allowed exceptions are left out of each rule's evidence, so allowing one justified break never drops the rule it breaks (and an allowance never promotes a rule that was not adopted). An exception without a reason is rejected, and `allow` refuses a rule that does not report the file. `--remove` takes an exception back out, and `eject` removes the list.

ESLint also gets more precise for the rules that share `no-restricted-imports` (import style, test isolation): a file excepted for one of them is still checked by the others. Before, an exception for one of them exempted the file from all of them.

File exceptions in the generated ESLint config, including the ones grandfathered at adoption, now also match when your ESLint config sits at the root of a monorepo: each one is written with the app's path in front as well as relative to the app, so it applies to that app only.
