-- Enable Row Level Security on all public tables.
--
-- This app accesses data exclusively through the Drizzle ORM over the
-- `postgres` superuser role (transaction pooler), which bypasses RLS.
-- Storage operations use the service_role admin client, also exempt.
--
-- Enabling RLS with no policies means the PostgREST surface (anon /
-- authenticated roles) is completely locked out of data tables — the
-- correct posture for an internal server-side app.

ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bid_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_group_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_template_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.charts_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gl_import_formats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gl_property_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gl_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interior_budget_line_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interior_budget_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interior_budget_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interior_unit_group_floorplans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interior_unit_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mapping_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_stage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.punch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rent_roll_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rent_roll_formats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rent_roll_mapping_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rent_roll_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scope_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
