-- When the contract for this project was signed.
--
-- The fourth pre-con gate. Deliberately just the fact, not the machinery: an
-- e-signature flow, a contract template and a generated document are all coming,
-- and every one of them ends by asserting "this was signed on this date". Storing
-- that now means the gate works today by hand and the wizard later fills the same
-- column rather than replacing it.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "contract_signed_at" date;
