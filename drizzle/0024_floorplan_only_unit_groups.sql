-- Interior budget: the pivot's columns are always the rent roll's floorplan types.
--
-- Unit groups used to be seedable three ways — by bedroom count, by floorplan
-- code, or by square-footage band — with the choice remembered so a later refresh
-- could re-apply it. Seeding is now one group per floorplan code, so there is no
-- mode to remember and no band edges to store.
--
-- Existing unit groups are left alone: a property seeded under the old bedroom
-- mode keeps its groups, pinned amounts and plan rows until someone re-seeds from
-- the Unit groups panel, which already confirms before dropping a group.

ALTER TABLE "interior_budget_settings" DROP COLUMN IF EXISTS "grouping_mode";--> statement-breakpoint
ALTER TABLE "interior_budget_settings" DROP COLUMN IF EXISTS "sqft_breakpoints";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."interior_grouping_mode";
