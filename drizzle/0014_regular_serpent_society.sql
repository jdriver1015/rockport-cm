ALTER TABLE "cost_categories" ALTER COLUMN "chart_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_codes" ALTER COLUMN "chart_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "mapping_rules" ALTER COLUMN "chart_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ALTER COLUMN "chart_of_accounts_id" SET NOT NULL;