-- The person accountable for a project.
--
-- The first ASSIGNMENT column in this schema. Every other profiles reference
-- records who did a thing — created_by, uploaded_by, recorded_by,
-- budget_locked_by — and none of them says who owns one. The board had no way to
-- answer "whose is this", which is the first question asked of a list of
-- thirteen live projects.
--
-- Nullable on purpose and staying that way: every project predating this column
-- has nobody named, and "unassigned" is a real state the board shows and filters
-- on rather than a gap to backfill with a guess.
--
-- No ON DELETE clause, matching every other profiles reference here. Profiles
-- are soft-deleted (profiles.archived_at), so a departed manager keeps their
-- name on the projects they ran instead of those rows silently going unassigned.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "manager_id" uuid REFERENCES "profiles"("id");

-- Grouping and sorting the board by manager, and the eventual "my projects"
-- filter, all read this column.
CREATE INDEX IF NOT EXISTS "projects_manager_idx" ON "projects" ("manager_id");
