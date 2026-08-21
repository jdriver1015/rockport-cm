-- A pre-walk is an appointment, so it needs a time of day.
--
-- Added as a separate column rather than widening pre_walk_date to timestamptz:
-- six schedule views (agenda, calendar, gantt) group and parse that column as a
-- plain date string, and turning it into an instant would reintroduce exactly
-- the timezone class of bug that shifted suggested dates by a day. The date is
-- what everything schedules against; the time is a detail of the appointment.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "pre_walk_time" time;

-- Which kind of walk an audit is.
--
-- A pre-walk produces the scope; a quality walk checks work already done. They
-- share every column and the same findings-and-photos screen, but the pre-con
-- gate has to find THE pre-walk for a project, and "the audit that happens to be
-- earliest" is not that. Existing rows are quality walks — none of them were
-- created as a pre-walk.
ALTER TABLE "site_audits" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'quality';

ALTER TABLE "site_audits" DROP CONSTRAINT IF EXISTS "site_audits_kind";
ALTER TABLE "site_audits" ADD CONSTRAINT "site_audits_kind"
  CHECK ("kind" IN ('pre_walk', 'quality'));

-- One pre-walk per project. A second would make "the" pre-walk ambiguous for the
-- gate, and re-walking a unit is a new finding on the same walk, not a new walk.
CREATE UNIQUE INDEX IF NOT EXISTS "site_audits_one_prewalk_per_project_idx"
  ON "site_audits" ("project_id")
  WHERE "kind" = 'pre_walk' AND "archived_at" IS NULL AND "project_id" IS NOT NULL;
