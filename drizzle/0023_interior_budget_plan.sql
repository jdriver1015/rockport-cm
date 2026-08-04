-- Interior budget plan: the two-dimensional renovation budget.
--
-- Adds the (unit group × upgrade tier) matrix that the Budget tab's Interior
-- pivot renders. The upgrade tier is an existing budget_groups row; a tier
-- becomes a pivot column exactly when it has an interior_budget_plan row.
--
-- Tables only — no data movement. Backfilling existing properties is a separate
-- opt-in step (scripts/build-interior-plan.ts) because it must assert that the
-- derived interior total ties to the prior hand-entered total to the penny.

DO $$ BEGIN
 CREATE TYPE "public"."interior_grouping_mode" AS ENUM('beds', 'floorplan', 'sqft');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Per-property/template row labels. Cost code names are chart-global, so
-- without these a per-property pricing basis ("Quartz counters 2cm $35/sf")
-- can't be expressed.
ALTER TABLE "budget_template_lines" ADD COLUMN IF NOT EXISTS "description" text;--> statement-breakpoint
ALTER TABLE "budget_group_lines" ADD COLUMN IF NOT EXISTS "description" text;--> statement-breakpoint

-- The pivot's columns. unit_count and avg_sqft are DERIVED from rent_roll_units
-- through the floorplan map; the *_override columns exist only for
-- pre-acquisition underwriting where no rent roll exists yet.
CREATE TABLE IF NOT EXISTS "interior_unit_groups" (
  "id" serial PRIMARY KEY NOT NULL,
  "property_id" integer NOT NULL REFERENCES "properties"("id"),
  "name" text NOT NULL,
  "bedrooms" integer,
  "baths" numeric(4, 1),
  "unit_count_override" integer,
  "avg_sqft_override" numeric(10, 2),
  "source_batch_id" integer REFERENCES "rent_roll_batches"("id"),
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "interior_unit_groups_property_idx"
  ON "interior_unit_groups" ("property_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "interior_unit_group_floorplans" (
  "id" serial PRIMARY KEY NOT NULL,
  "property_id" integer NOT NULL REFERENCES "properties"("id"),
  "unit_group_id" integer NOT NULL REFERENCES "interior_unit_groups"("id") ON DELETE CASCADE,
  "floor_plan_code" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "interior_unit_group_floorplans_group_idx"
  ON "interior_unit_group_floorplans" ("unit_group_id");
--> statement-breakpoint
-- Keyed on the PROPERTY, not the group: the same floorplan mapped into two
-- groups would silently double-count its units in the budget.
CREATE UNIQUE INDEX IF NOT EXISTS "interior_unit_group_floorplans_property_code_uq"
  ON "interior_unit_group_floorplans" ("property_id", "floor_plan_code");
--> statement-breakpoint

-- planned_units is fractional on purpose: penetration is entered as a
-- percentage and lands on values like 205.1 units. Rounding to 205 shifts the
-- budget ~$9k and breaks the tie to the underwriting model.
-- No row = tier not offered to this group. 0 = offered, none planned.
CREATE TABLE IF NOT EXISTS "interior_budget_plan" (
  "id" serial PRIMARY KEY NOT NULL,
  "property_id" integer NOT NULL REFERENCES "properties"("id"),
  "unit_group_id" integer NOT NULL REFERENCES "interior_unit_groups"("id") ON DELETE CASCADE,
  "budget_group_id" integer NOT NULL REFERENCES "budget_groups"("id") ON DELETE CASCADE,
  "planned_units" numeric(10, 2) DEFAULT '0' NOT NULL,
  "note" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "interior_budget_plan_property_idx"
  ON "interior_budget_plan" ("property_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "interior_budget_plan_group_tier_uq"
  ON "interior_budget_plan" ("unit_group_id", "budget_group_id");
--> statement-breakpoint

-- Pinned cell amounts. Keyed on (budget_group_id, cost_code_id, unit_group_id)
-- rather than a budget_group_lines id: duplicateGroup re-inserts lines with
-- fresh ids and deleteGroupLine hard-deletes, so a line-id key would discard
-- every pin the first time someone duplicates a tier. The existing
-- UNIQUE(budget_group_id, cost_code_id) already makes this triple identify at
-- most one line.
--
-- `amount` is a TOTAL, not a rate — a pin on a per-square-foot line is the
-- finished dollar figure and must never be multiplied by square footage.
CREATE TABLE IF NOT EXISTS "interior_budget_line_overrides" (
  "id" serial PRIMARY KEY NOT NULL,
  "property_id" integer NOT NULL REFERENCES "properties"("id"),
  "budget_group_id" integer NOT NULL REFERENCES "budget_groups"("id") ON DELETE CASCADE,
  "cost_code_id" integer NOT NULL REFERENCES "cost_codes"("id"),
  "unit_group_id" integer NOT NULL REFERENCES "interior_unit_groups"("id") ON DELETE CASCADE,
  "amount" numeric(12, 2) NOT NULL,
  "note" text,
  "created_by" uuid REFERENCES "profiles"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "interior_budget_line_overrides_property_idx"
  ON "interior_budget_line_overrides" ("property_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "interior_budget_line_overrides_cell_uq"
  ON "interior_budget_line_overrides" ("budget_group_id", "cost_code_id", "unit_group_id");
--> statement-breakpoint

-- Uplift rates are budget-only: they inflate the budgeted figure but never
-- become scope lines on a project, so a unit project's budget stays real scope
-- cost and contingency isn't a cost code that reads permanently underspent.
-- The cost-code pointers are what keep the pivot's grand total reconciling to
-- the Budget tab's Interiors division.
CREATE TABLE IF NOT EXISTS "interior_budget_settings" (
  "property_id" integer PRIMARY KEY NOT NULL REFERENCES "properties"("id"),
  "cm_supervision_pct" numeric(6, 3) DEFAULT '0' NOT NULL,
  "contingency_pct" numeric(6, 3) DEFAULT '0' NOT NULL,
  "cm_cost_code_id" integer REFERENCES "cost_codes"("id"),
  "contingency_cost_code_id" integer REFERENCES "cost_codes"("id"),
  "grouping_mode" "interior_grouping_mode" DEFAULT 'beds' NOT NULL,
  "sqft_breakpoints" jsonb,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
