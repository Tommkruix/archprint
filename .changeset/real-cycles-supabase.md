---
'archprint': patch
---

Three fixes found by reviewing archprint's output on popular open-source repos before writing about them:

- Circular dependencies are now shown as a real import loop, for example `a.ts -> b.ts -> a.ts`, plus how many other files are in the same cycle. Before, the files of a cycle were listed in alphabetical order with arrows between them, which read like an import chain that did not exist.
- The rule that request handlers must not import the database client directly now recognises Supabase (`@supabase/supabase-js`, `@supabase/ssr`, `@supabase/postgrest-js` and the older auth helpers) and your own modules that create a Supabase client, so an app that reaches its database through Supabase is no longer told its handlers avoid the database. Database client modules created with a type argument, such as `new Kysely<DB>(...)` or `createServerClient<Database>(...)`, are recognised too.
- The UI and data rule now says what it measures: components that never import the data layer directly. It no longer claims they go "through services", which it does not check.
