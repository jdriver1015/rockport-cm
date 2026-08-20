-- Finish specs and the fixture kit: the tables a GC orders from.
--
-- Trade scope is prose about responsibility ("prep, prime, two finish coats").
-- This is the other half of a bid sheet: the exact colour, product, model and
-- vendor. Kept as separate grids rather than one wide table because the columns
-- genuinely differ — paint needs colour / product / SW number / sheen, flooring
-- needs area and spec, appliances need model numbers.
--
-- Same dual-owner shape as trade_scopes: a portfolio template holds the standard,
-- a property's renovation type holds its departures.
CREATE TABLE IF NOT EXISTS "spec_tables" (
  "id" serial PRIMARY KEY,
  "template_id" integer REFERENCES "budget_templates"("id") ON DELETE CASCADE,
  "budget_group_id" integer REFERENCES "budget_groups"("id") ON DELETE CASCADE,
  -- Which section of the bid sheet this grid belongs under. Two values today
  -- ('finish', 'fixture'); text rather than an enum so adding a section is a
  -- code change, not a migration plus an enum alter.
  "kind" text NOT NULL,
  "title" text NOT NULL,
  -- {cols: string[], rows: string[][]} — the same shape scope_items.specs
  -- already uses. A grid rather than typed columns because each table's columns
  -- are its own, and a spec sheet is read as a table, not queried by column.
  "grid" jsonb NOT NULL DEFAULT '{"cols":[],"rows":[]}'::jsonb,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "spec_tables_one_owner" CHECK (
    ("template_id" IS NOT NULL AND "budget_group_id" IS NULL)
    OR ("template_id" IS NULL AND "budget_group_id" IS NOT NULL)
  ),
  CONSTRAINT "spec_tables_kind" CHECK ("kind" IN ('finish', 'fixture'))
);

-- One table per title per owner per section, so a copy between levels replaces
-- "Paint" rather than adding a second one.
CREATE UNIQUE INDEX IF NOT EXISTS "spec_tables_template_title_idx"
  ON "spec_tables" ("template_id", "kind", "title") WHERE "template_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "spec_tables_group_title_idx"
  ON "spec_tables" ("budget_group_id", "kind", "title") WHERE "budget_group_id" IS NOT NULL;
