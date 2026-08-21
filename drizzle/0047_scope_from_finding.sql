-- Where a scope line came from.
--
-- With the pre-walk first, the walk's findings are what the scope is written
-- from. Recording which finding produced a line does two things: the import
-- can offer only the findings not yet taken, and a line can say why it exists.
--
-- SET NULL rather than CASCADE: deleting a finding must not delete the scope
-- line, and therefore the work, that it caused.
ALTER TABLE "scope_items"
  ADD COLUMN IF NOT EXISTS "source_finding_id" integer REFERENCES "audit_findings"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "scope_items_source_finding_idx"
  ON "scope_items" ("source_finding_id") WHERE "source_finding_id" IS NOT NULL;
