---
'archprint': patch
---

Make the scan report label consistent with what actually ships. The structural-inference families (layer,
role-layering, entry-purity, ui/data, server/client, feature-slice, app-isolation, env-access,
workspace-package, stories) now render as "(review before enforcing)" instead of "(enforceable)", matching the
fact that `generate` holds them for review by default; the mechanical families keep "(enforceable)".
