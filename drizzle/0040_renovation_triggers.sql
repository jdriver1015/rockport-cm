-- How a unit gets assigned a renovation type, and the record of why it did.
--
-- The renovation type says what a turn is; nothing said how a walker chooses
-- between them at pre-walk. That decision lived in people's heads, so "why is
-- unit 002 Signature?" had no answer a month later.
--
-- Property-level, NOT templated onto renovation types: this is the rule that
-- decides BETWEEN types, so it cannot belong to one of them. Ordered steps, and
-- the first step whose condition is met assigns its type.
CREATE TABLE IF NOT EXISTS "renovation_trigger_steps" (
  "id" serial PRIMARY KEY,
  "property_id" integer NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
  -- Which renovation type this step assigns. Cascades: a step pointing at a type
  -- that no longer exists would assign nothing and read as a rule that works.
  "budget_group_id" integer NOT NULL REFERENCES "budget_groups"("id") ON DELETE CASCADE,
  -- 'any' — any checked condition fires the step. 'all' — every one must be.
  "mode" text NOT NULL DEFAULT 'any',
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "renovation_trigger_steps_mode" CHECK ("mode" IN ('any', 'all'))
);
CREATE INDEX IF NOT EXISTS "renovation_trigger_steps_property_idx"
  ON "renovation_trigger_steps" ("property_id", "sort_order");

CREATE TABLE IF NOT EXISTS "renovation_trigger_conditions" (
  "id" serial PRIMARY KEY,
  "step_id" integer NOT NULL REFERENCES "renovation_trigger_steps"("id") ON DELETE CASCADE,
  "text" text NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "renovation_trigger_conditions_step_idx"
  ON "renovation_trigger_conditions" ("step_id", "sort_order");

-- What the walker actually answered on one unit.
CREATE TABLE IF NOT EXISTS "project_trigger_answers" (
  "id" serial PRIMARY KEY,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  -- The condition answered, if it still exists. SET NULL rather than CASCADE:
  -- deleting a condition from the rule must not delete the history of units that
  -- were assigned because of it.
  "condition_id" integer REFERENCES "renovation_trigger_conditions"("id") ON DELETE SET NULL,
  -- The condition's wording AS ANSWERED. Snapshotted because the rule is edited
  -- over time: without this, rewording a condition would silently rewrite the
  -- recorded justification for every unit already walked, and deleting one would
  -- erase it.
  "condition_text" text NOT NULL,
  "checked" boolean NOT NULL DEFAULT false,
  "recorded_by" uuid REFERENCES "profiles"("id"),
  "recorded_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "project_trigger_answers_project_idx"
  ON "project_trigger_answers" ("project_id");
-- One answer per condition per unit, so re-walking updates rather than appends.
CREATE UNIQUE INDEX IF NOT EXISTS "project_trigger_answers_unique_idx"
  ON "project_trigger_answers" ("project_id", "condition_id") WHERE "condition_id" IS NOT NULL;
