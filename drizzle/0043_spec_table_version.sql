-- Optimistic-locking counter for spec tables.
--
-- The first attempt at this used updated_at as the version token, which cannot
-- work: timestamptz keeps microseconds, JavaScript Date only milliseconds, so
-- the token a client reads back never equals the stored value and every save is
-- refused as a conflict. An integer has no precision to lose.
ALTER TABLE "spec_tables" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;
