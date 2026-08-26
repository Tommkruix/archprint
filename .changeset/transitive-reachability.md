---
'archprint': minor
---

Add transitive layer reachability. `computeLayerReachability` condenses the first-party import graph by
strongly-connected component into a DAG and computes, for every layer, the set of layers a file in it can
reach through a chain of value imports. The scan now flags an AUTO layer boundary that a plain import rule
would pass but that still leaks through an intermediary layer (`from` reaches `to` transitively), pointing at
the stronger dependency-cruiser `reachable` form. The cycle, orphan, and reachability passes now share one
prebuilt import graph and one strongly-connected-components routine, so a full scan builds the graph once.
