-- One live interior project per unit, enforced by the database.
--
-- createInteriorProject already refuses a second project for a unit, but that
-- is a check-then-insert: under Postgres' default READ COMMITTED two concurrent
-- transactions both read no clash and both insert. A double-clicked Create, or
-- two open tabs, produced two projects for one unit and double-counted it in
-- the interior budget.
--
-- Partial so it constrains only what should be unique: archived projects are
-- history and a unit may legitimately be re-turned after one is archived, and
-- common-area projects have no unit at all.
CREATE UNIQUE INDEX IF NOT EXISTS "projects_one_live_project_per_unit_idx"
  ON "projects" ("unit_id")
  WHERE "kind" = 'unit' AND "archived_at" IS NULL AND "unit_id" IS NOT NULL;
