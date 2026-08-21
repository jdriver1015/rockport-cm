-- Capability URLs that let a vendor price a scope without an account.
--
-- One token per bid. The token IS the authorisation: whoever holds the link can
-- read that bid's lines and write amounts on them, and nothing else — not the
-- project, not the property, not another vendor's bid.
--
-- Stored as the literal token rather than a hash. A hash would be better if this
-- guarded something sensitive, but the capability here is a scope list and one
-- vendor's own prices, and anyone with read access to this table already has
-- every bid in the database. In exchange the link stays re-copyable, which
-- matters when a vendor loses the email. Expiry and revocation are the controls
-- that do the work.
CREATE TABLE IF NOT EXISTS "bid_access_tokens" (
  "id" serial PRIMARY KEY,
  "bid_id" integer NOT NULL REFERENCES "bids"("id") ON DELETE CASCADE,
  /** 32 random bytes, base64url. Long enough that guessing is not a threat. */
  "token" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  /** Set to kill the link early — a reissue revokes whatever came before. */
  "revoked_at" timestamptz,
  "created_by" uuid REFERENCES "profiles"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- The lookup is by token on every portal request, and it must be unique.
CREATE UNIQUE INDEX IF NOT EXISTS "bid_access_tokens_token_idx" ON "bid_access_tokens" ("token");

-- At most one live token per bid, so "the link for this bid" is unambiguous and
-- an old link cannot quietly keep working after a reissue.
CREATE UNIQUE INDEX IF NOT EXISTS "bid_access_tokens_one_live_per_bid_idx"
  ON "bid_access_tokens" ("bid_id") WHERE "revoked_at" IS NULL;
