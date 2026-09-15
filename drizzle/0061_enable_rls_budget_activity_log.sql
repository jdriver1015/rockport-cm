-- Enable Row Level Security on the new budget activity log table, consistent
-- with every other table (see 0035_enable_rls_all_tables.sql). The app
-- reads/writes exclusively through Drizzle over the postgres superuser role,
-- which bypasses RLS; enabling it with no policies locks the PostgREST
-- surface (anon/authenticated roles) out entirely.

ALTER TABLE public.budget_line_activity_log ENABLE ROW LEVEL SECURITY;
