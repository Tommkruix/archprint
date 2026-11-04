---
'archprint': patch
---

Fixed three ways the generated dependency-cruiser rules could be wrong. The role-layering, feature-slice, app-isolation, stories-isolation and UI/data rules did not exempt the files they were inferred with, so adopting one could fail dependency-cruiser straight away on code that already broke it. Those rules, the public-API rules and test isolation also ignored `archprint allow`, so an allowed file kept failing in dependency-cruiser. All of them now exempt both. For an app below the repository root, such as `apps/web`, the public-API, feature-slice and app-isolation rules matched paths without the app's folder, so dependency-cruiser, which reports `apps/web/src/...`, never applied them. They now include it. Run `archprint generate` to refresh `.archprint/dependency-cruiser.json`. `archprint allow` now says to regenerate for these rules too, instead of telling you to edit dependency-cruiser's config by hand.
