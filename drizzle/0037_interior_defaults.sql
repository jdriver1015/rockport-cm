-- Portfolio defaults for interiors: which renovation types a new property
-- inherits, and what uplift settings it starts with.
--
-- Three of five properties currently have no renovation types at all, because
-- nothing carried the portfolio's standard scopes across at creation — each one
-- had to be rebuilt by hand. Enhanced and Signature ARE the portfolio standard,
-- so they are what a new property should start from.

-- Marks a template as one a new property inherits. Not derived from `active`:
-- a template can be current and still be property-specific rather than
-- standard, and the create form offers the full list either way — this only
-- decides what is pre-checked.
ALTER TABLE "budget_templates" ADD COLUMN IF NOT EXISTS "seed_by_default" boolean NOT NULL DEFAULT false;

UPDATE "budget_templates" SET "seed_by_default" = true
WHERE "name" IN ('Enhanced', 'Signature') AND "archived_at" IS NULL;

-- Singleton: one row of portfolio-wide interior defaults. The CHECK is what
-- makes it a singleton rather than a convention — a second row would silently
-- become a second source of truth for what a new property starts with.
CREATE TABLE IF NOT EXISTS "interior_default_settings" (
  "id" integer PRIMARY KEY DEFAULT 1 CONSTRAINT "interior_default_settings_singleton" CHECK ("id" = 1),
  "cm_supervision_pct" numeric(6,3) NOT NULL DEFAULT '0',
  "contingency_pct" numeric(6,3) NOT NULL DEFAULT '0',
  "cm_enabled" boolean NOT NULL DEFAULT true,
  "contingency_enabled" boolean NOT NULL DEFAULT true,
  -- Cost CODES, not ids: a default has to outlive any one chart of accounts,
  -- and each property picks its chart at creation. Same reasoning as
  -- budget_template_lines.cost_code_ref. A ref with no match in the chosen
  -- chart must surface at creation, or the property silently starts with
  -- unattributed uplifts and its pivot stops reconciling to the Interiors
  -- division.
  "cm_cost_code_ref" text,
  "contingency_cost_code_ref" text,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

INSERT INTO "interior_default_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
