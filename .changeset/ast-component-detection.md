---
'archprint': patch
---

Identify UI components by rendered JSX, not the `.tsx` extension.

A component is now recognized when it actually renders JSX (a JSX element/fragment, or a
`React.createElement`/`cloneElement` call), matching how react-docgen and eslint-plugin-react define a
component, instead of trusting the `.tsx` file extension. A non-rendering `.tsx` file (types, constants,
re-exports) no longer inflates a directory's component count, and a `.ts` file that renders via
`createElement` is correctly counted. Detection uses a syntactic parse only (no type checker), so it stays
fast. No marker change on inbox-zero, dub, formbricks, or cal.com.
