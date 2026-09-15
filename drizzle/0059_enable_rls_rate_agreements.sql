-- Enable Row Level Security on the two new vendor-rate-agreement tables,
-- consistent with every other table (see 0035_enable_rls_all_tables.sql).
-- The app reads/writes exclusively through Drizzle over the postgres
-- superuser role, which bypasses RLS; enabling it with no policies locks
-- the PostgREST surface (anon/authenticated roles) out entirely.

ALTER TABLE public.vendor_rate_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_rate_agreement_lines ENABLE ROW LEVEL SECURITY;
