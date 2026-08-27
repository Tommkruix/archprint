---
'archprint': minor
---

Add UI/data separation: reusable UI components (COMPONENT role) should reach the data layer through services,
not import the DB/data layer (`DB_MODULE` / `DATA_ACCESS`) directly. `detectUiDataIsolation` gates it with the
Wilson floor over the component population, and `archprint generate` writes
`dependency-cruiser.ui-data.archprint.json`.
