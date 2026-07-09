<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Westcreek Construction Manager

Internal multifamily construction tracking app. See README.md for the domain model and stack.

## Conventions

- Schema lives in `src/db/schema.ts` (Drizzle). Change schema → `npm run db:generate` → `npm run db:migrate`. Never hand-edit files in `drizzle/`.
- Get a DB handle via `db()` from `src/db/index.ts` — it is lazy so builds work without `DATABASE_URL`.
- Money columns are `numeric(12,2)` and come back from Drizzle as strings; parse at the edge, never store floats.
- Derived figures (left-to-invoice, variance, days-to-complete, trade-out %) are computed in queries/views, never stored.
- Actuals only enter through the GL intake pipeline (`import_batches` → staged `gl_transactions` → review → posted). Do not write endpoints that insert posted transactions directly.
- Stage changes must write a `project_stage_events` / `turn_stage_events` row; timestamps there drive the analytics.
- Verify with `npm run typecheck` and `npm run lint` before committing.

