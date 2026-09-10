-- The punch walk becomes a first-class walk, mirroring the pre-walk.
--
-- Hand-written rather than used as generated. schema.ts had never declared the
-- CHECK or the one-pre-walk-per-project index that migration 0045 created, so
-- drizzle believed both were new and emitted a bare CREATE / ADD CONSTRAINT
-- that would have failed against a database where they already exist. They are
-- declared in schema.ts now — which is what makes the generated SNAPSHOT
-- correct, and the snapshot is what future diffs read — while the statements
-- below are the idempotent form of the same thing.

-- 'punch_walk' joins the allowed kinds. Dropped and re-added because a CHECK
-- cannot be altered in place.
ALTER TABLE "site_audits" DROP CONSTRAINT IF EXISTS "site_audits_kind";
ALTER TABLE "site_audits" ADD CONSTRAINT "site_audits_kind"
  CHECK ("kind" IN ('pre_walk', 'punch_walk', 'quality'));

-- Already exists from 0045; declared here only so the two rules sit together.
CREATE UNIQUE INDEX IF NOT EXISTS "site_audits_one_prewalk_per_project_idx"
  ON "site_audits" ("project_id")
  WHERE "kind" = 'pre_walk' AND "archived_at" IS NULL AND "project_id" IS NOT NULL;

-- One punch walk per project, the same rule for the same reason: the gate that
-- reads it has to find exactly one.
CREATE UNIQUE INDEX IF NOT EXISTS "site_audits_one_punchwalk_per_project_idx"
  ON "site_audits" ("project_id")
  WHERE "kind" = 'punch_walk' AND "archived_at" IS NULL AND "project_id" IS NOT NULL;
