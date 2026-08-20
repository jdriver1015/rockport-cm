-- Lets a property turn either uplift off without losing the rate it uses.
--
-- Zeroing the percentage was the only way to switch CM / supervision or
-- contingency off, which threw away the figure and made "off" and "0%"
-- indistinguishable — so a property that stops carrying contingency for one
-- budget cycle has to re-enter the rate to resume. The flag separates whether
-- the uplift applies from what it costs, and defaults to true so every existing
-- property keeps computing exactly as it does today.
ALTER TABLE "interior_budget_settings" ADD COLUMN IF NOT EXISTS "cm_enabled" boolean NOT NULL DEFAULT true;
ALTER TABLE "interior_budget_settings" ADD COLUMN IF NOT EXISTS "contingency_enabled" boolean NOT NULL DEFAULT true;
