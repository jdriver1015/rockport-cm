-- Add `original_cost_code_id` to gl_transactions.
--
-- Records the cost code this row was last POSTED AS, so an un-post / restore
-- can put it back. Set the first time a row moves to `posted`; thereafter it
-- is sticky and survives later corrections.
--
-- Nullable: existing posted rows will be backfilled with their current
-- cost_code_id in a one-off script (scripts/backfill-original-cost-code.ts).
-- New rows default to null until their first post.
ALTER TABLE "gl_transactions" ADD COLUMN "original_cost_code_id" integer REFERENCES "cost_codes"("id");
