-- Audit trail for learned mapping rules.
--
-- mapping_rules.created_by is the profile id of the first user whose action
-- learned this rule. Nullable so legacy learned rules (rows that pre-date
-- the column) keep a null attribution rather than being silently rewritten.
ALTER TABLE "mapping_rules" ADD COLUMN "created_by" uuid REFERENCES "profiles"("id");
