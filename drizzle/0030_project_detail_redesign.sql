-- Fields the redesigned project detail page renders directly.
--
-- project_milestones.note      — what happened at that milestone, shown inline
--                                on the timeline next to planned/actual.
-- scope_items.vendor_id        — the trade partner on that line. Distinct from
--                                projects.vendor_id, which is the overall GC;
--                                a single project routinely spans many trades.
-- scope_items.start_date/      — that line's own window inside the project
-- scope_items.end_date           schedule, shown on the scope row.
--
-- All nullable: existing rows keep a blank value rather than being backfilled
-- with a guess.
ALTER TABLE "project_milestones" ADD COLUMN IF NOT EXISTS "note" text;
ALTER TABLE "scope_items" ADD COLUMN IF NOT EXISTS "vendor_id" integer REFERENCES "vendors"("id");
ALTER TABLE "scope_items" ADD COLUMN IF NOT EXISTS "start_date" date;
ALTER TABLE "scope_items" ADD COLUMN IF NOT EXISTS "end_date" date;
