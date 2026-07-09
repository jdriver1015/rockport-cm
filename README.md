# Westcreek Construction Manager

Internal tool for tracking multifamily construction projects across the Westcreek portfolio: underwriting budgets, GL file intake reconciled to the internal chart of accounts, scope and unit-turn tracking with stage pipelines, photos, and drillable budget-vs-actual reporting.

Replaces the per-property Excel construction trackers (baseline: *Retreat at Westpark — Construction Tracker.xlsx*).

## Stack

- **Next.js 16 + TypeScript** (App Router, `src/` layout) — UI, API routes, and server-side GL parsing in one codebase
- **Tailwind CSS v4 + shadcn/ui** — UI components
- **Postgres via Supabase**, **Drizzle ORM** — schema in [`src/db/schema.ts`](src/db/schema.ts)
- **Supabase Auth** (email/password + magic links) and **Supabase Storage** (photos, GL files)
- **SheetJS (`xlsx`)** for GL import parsing; **exceljs** for formatted Excel exports

## Getting started

1. `npm install`
2. Create a Supabase project, then copy `.env.example` to `.env.local` and fill in the values
3. `npm run db:push` — create tables (or `db:generate` + `db:migrate` for versioned migrations)
4. `npm run db:seed` — load the master chart of accounts (Cost Code Bank)
5. `npm run dev`

## Domain model (short version)

- **Chart of accounts** is portfolio-level master data: `cost_categories` (4-digit lender codes, 1000–4000) → `cost_codes` (`1100-0001 Roofing Repair`). The 4000-series is flagged `is_interior` and tracks at the unit-turn level; everything else tracks at the scope level.
- **Projects** move through seven gated stages: setup → bidding → mobilization → in_progress → punch_walk → final_completion → closed. Stage changes are recorded in `project_stage_events`.
- **Money is a three-way view:** `budget_lines.uw_amount` (underwriting) → `scopes.committed_cost` (approved bids) → posted `gl_transactions` (JTD actual). Left-to-invoice and variance are derived, never stored.
- **GL intake** is the only way actuals enter: upload file → `import_batches` → rows staged as `gl_transactions` → auto-mapped via `mapping_rules` (GL account / vendor / keyword → cost code) → review queue → posted. Every transaction keeps its source file row for drill-back.
- **Unit turns** run their own pipeline (planned → vacant_ready → in_progress → punch → complete → invoiced → leased) with stage timestamps driving days-to-complete; rent fields drive trade-out and ROI analytics.
- **Attachments** (photos, invoices, lien waivers) attach to projects, scopes, unit turns, punch items, or transactions and are always tagged with the stage at upload time.
