-- Planned units become a whole count.
--
-- The column was numeric(10,2) so a percentage-driven pro-rata spread could tie
-- to the penny against the source underwriting workbook, which plans 70% of 293
-- units as 205.1. Penetration is no longer an input — it is derived for display
-- from a whole unit count — so the fractional precision has nothing left to
-- represent, and half a renovated apartment was never a real quantity.
--
-- round() on numeric rounds halves away from zero, so the existing .50 values go
-- up: 18.50 -> 19, 15.50 -> 16, 6.50 -> 7. That adds a small amount of planned
-- scope rather than silently dropping it.

ALTER TABLE "interior_budget_plan" ALTER COLUMN "planned_units" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "interior_budget_plan"
  ALTER COLUMN "planned_units" TYPE integer USING round("planned_units")::integer;--> statement-breakpoint
ALTER TABLE "interior_budget_plan" ALTER COLUMN "planned_units" SET DEFAULT 0;
