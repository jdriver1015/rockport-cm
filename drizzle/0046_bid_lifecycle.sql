-- A bid's life: drafted, sent to a vendor, returned priced, then chosen or not.
--
-- The table already held `received_date` and `approved`, which describe the end
-- of the story but not the middle — there was no way to know a scope had gone
-- out for pricing at all. An RFP and a returned bid are the same shape (a bid
-- with a line per scope item), so this is a status on the existing row rather
-- than a second table: sending seeds the lines at zero, the vendor fills them in.
ALTER TABLE "bids" ADD COLUMN IF NOT EXISTS "sent_at" timestamptz;
ALTER TABLE "bids" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'draft';

ALTER TABLE "bids" DROP CONSTRAINT IF EXISTS "bids_status";
ALTER TABLE "bids" ADD CONSTRAINT "bids_status"
  CHECK ("status" IN ('draft', 'sent', 'received', 'awarded', 'declined'));

-- Existing rows were entered by hand after the fact, so they are received; the
-- one that won is awarded. Nothing in the old data was ever "sent" from here.
UPDATE "bids" SET "status" = CASE WHEN "approved" THEN 'awarded' ELSE 'received' END
WHERE "status" = 'draft';

CREATE INDEX IF NOT EXISTS "bids_project_status_idx" ON "bids" ("project_id", "status");
