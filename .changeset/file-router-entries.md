---
'archprint': patch
---

The dead-code lists no longer report routes that a file-based router loads by their location: every file of an Expo
Router `app/` folder, React Router's `root`, entry and `flatRoutes()` route modules (in the app folder its config
names) and the module paths its `routes.ts` passes to `route()`, `index()` and `layout()`, and the files under a TanStack Router `routesDirectory`. Other files in
those folders are still checked.
