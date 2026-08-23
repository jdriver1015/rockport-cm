-- Pre-construction gate 2 (Confirm scope) and the direct-award path on gate 3.

-- When the scope was confirmed as ready to price. Cleared when the RFPs that
-- locked it are withdrawn, so the gate re-opens with the lock.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "scope_confirmed_at" timestamptz;

-- 'rfp' — this bid was sent out and priced by the vendor.
-- 'direct' — assigned without competition; there was never a request.
-- Kept on the bid rather than the project so committed cost, the award and the
-- contract all read off one row whichever way the work was let.
ALTER TABLE "bids" ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'rfp';

-- Why competition was skipped. The point of the direct-award path: it makes
-- every uncompeted dollar answerable.
ALTER TABLE "bids" ADD COLUMN IF NOT EXISTS "award_reason" text;

-- 'withdrawn' — the request was pulled back so the scope could change. Distinct
-- from 'declined', which is the vendor's answer, not ours.
ALTER TABLE "bids" DROP CONSTRAINT IF EXISTS "bids_status";
ALTER TABLE "bids" ADD CONSTRAINT "bids_status"
  CHECK (status = ANY (ARRAY['draft','sent','received','awarded','declined','withdrawn']));

-- A bid is either competed or it is not; nothing else is a source.
ALTER TABLE "bids" DROP CONSTRAINT IF EXISTS "bids_source";
ALTER TABLE "bids" ADD CONSTRAINT "bids_source" CHECK (source = ANY (ARRAY['rfp','direct']));

-- A direct award has to say why competition was skipped. That is the entire
-- point of allowing the path: it keeps uncompeted spend answerable.
ALTER TABLE "bids" DROP CONSTRAINT IF EXISTS "bids_direct_needs_reason";
ALTER TABLE "bids" ADD CONSTRAINT "bids_direct_needs_reason"
  CHECK (source <> 'direct' OR (award_reason IS NOT NULL AND btrim(award_reason) <> ''));
