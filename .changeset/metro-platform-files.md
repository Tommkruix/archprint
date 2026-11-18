---
'archprint': patch
---

The dead-code lists no longer report React Native platform files that Metro picks for an import. In a project that
declares `react-native` or `expo`, an import of `./button` now also counts for `button.ios.tsx`, `button.android.tsx`,
`button.native.tsx` and, when the project declares `react-native-web` (or the Windows, macOS or tvOS packages),
`button.web.tsx` and the like, resolved in the order Metro tries them. A platform file no build picks is still listed.
