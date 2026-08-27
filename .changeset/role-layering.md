---
'archprint': minor
---

Add role-based layering, a new rule family that uses the classifier's semantic roles rather than directory
names, so it catches the classic backend tier hierarchy even when the tiers are named suffixes rather than
folders (NestJS-style). `detectRoleLayering` counts value edges between roles (CONTROLLER, SERVICE, REPOSITORY,
DATA_ACCESS, DB_MODULE), takes the minority direction of each interacting pair as the candidate boundary, and
gates it with the Wilson floor (using the classifier's confidence as roleConfidence). `archprint generate`
writes `dependency-cruiser.role-layering.archprint.json`.
