<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Westcreek Construction Manager

Internal multifamily construction tracking app. See README.md for the domain model and stack.

## Conventions

- Schema lives in `src/db/schema.ts` (Drizzle). Change schema → `npm run db:generate` → `npm run db:migrate`. Never hand-edit files in `drizzle/`.
- `drizzle/meta/` has no snapshots between `0035` and `0052` — migrations 0036–0051
  were written by hand and their snapshots never were. `generate` diffs against the
  newest snapshot it can find, so before `0052_snapshot.json` existed it diffed
  against `0035` and re-emitted sixteen migrations' worth of DDL: a "new" migration
  that re-created `project_contracts`, `bid_events`, `trade_scopes` and a dozen other
  live tables. Running it would have failed at best.
  `0052_snapshot.json` is a full baseline regenerated from `schema.ts` and verified
  column-for-column against the live database (51 tables, no drift), so `generate`
  is correct again from 0052 forward. Do not try to backfill the missing snapshots —
  they would each need the schema as it stood at that migration, which is not
  recoverable from the repo. The gap is history; the baseline is what matters.
- Get a DB handle via `db()` from `src/db/index.ts` — it is lazy so builds work without `DATABASE_URL`.
- Money columns are `numeric(12,2)` and come back from Drizzle as strings; parse at the edge, never store floats.
- Derived figures (left-to-invoice, variance, days-to-complete, trade-out %) are computed in queries/views, never stored.
- Actuals only enter through the GL intake pipeline (`import_batches` → staged `gl_transactions` → review → posted). Do not write endpoints that insert posted transactions directly.
- Stage changes must write a `project_stage_events` / `turn_stage_events` row; timestamps there drive the analytics.
- Reading a form: `formData.get(x) ?? undefined` for every optional field.
  `get` returns `null` for a field the form did not render, and the optional
  schemas here are `z.string().optional()` — they accept `undefined` and reject
  `null`. A conditionally rendered field parsed with a bare `get` fails the
  whole form with "expected string, received null". This is why a common-area
  project could not be edited at all: the dialog renders the rent fields only
  for unit projects.
- RLS is enabled on every table and there are deliberately **no policies**. Supabase's
  linter reports this as `rls_enabled_no_policy` (INFO) on ~43 tables — that is expected,
  not a finding. No policies means deny-all through the PostgREST API, and the app never
  reads data that way: the Supabase client is used only for auth and storage, while all
  data goes through Drizzle on a direct Postgres connection that bypasses RLS as table
  owner. Authorization lives in the action layer (`requireUser()` / `canWriteProperty()`,
  see `src/lib/auth.ts`). Verified: the public anon key returns 0 rows from every table.
  **Do not "fix" those warnings by adding permissive policies.** A `USING (true)` policy
  would expose the table to the anon key that ships to the browser, turning a non-issue
  into a real one. If client-side data access is ever wanted, that is a deliberate design
  change — write real per-row policies then, not blanket ones.
- Verify with `npm run typecheck` and `npm run lint` before committing.

