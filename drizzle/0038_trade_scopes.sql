-- Written trade scope — the narrative a GC actually bids from, per renovation
-- type. Pricing says what a turn costs; this says what the work is.
--
-- One table serves both levels, keyed by exactly one owner: a portfolio
-- template (the standard wording, written once) or a property's renovation type
-- (that property's departures from it). Two tables would mean two of every
-- query, action and component for text that is identical in shape, and the copy
-- path between the levels would have to translate between them.
CREATE TABLE IF NOT EXISTS "trade_scopes" (
  "id" serial PRIMARY KEY,
  "template_id" integer REFERENCES "budget_templates"("id") ON DELETE CASCADE,
  "budget_group_id" integer REFERENCES "budget_groups"("id") ON DELETE CASCADE,
  -- The trade this paragraph covers. Stored as the heading text rather than a
  -- foreign key to a trades table: the canonical thirteen live in code
  -- (src/lib/trade-scope.ts) and a property is free to add one Drew's template
  -- never anticipated, so there is no closed set to point at.
  "heading" text NOT NULL,
  "body" text,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  -- Exactly one owner. Without this a row could belong to both levels at once
  -- (whose wording wins?) or to neither, becoming invisible and unreachable.
  CONSTRAINT "trade_scopes_one_owner" CHECK (
    ("template_id" IS NOT NULL AND "budget_group_id" IS NULL)
    OR ("template_id" IS NULL AND "budget_group_id" IS NOT NULL)
  )
);

-- One paragraph per trade per owner. The upsert in saveTradeScope targets these,
-- so without them a re-save would append a second paragraph for the same trade
-- instead of replacing it.
CREATE UNIQUE INDEX IF NOT EXISTS "trade_scopes_template_heading_idx"
  ON "trade_scopes" ("template_id", "heading") WHERE "template_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "trade_scopes_group_heading_idx"
  ON "trade_scopes" ("budget_group_id", "heading") WHERE "budget_group_id" IS NOT NULL;
