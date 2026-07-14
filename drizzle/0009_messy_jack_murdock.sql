ALTER TABLE "profiles" DROP CONSTRAINT "profiles_email_unique";--> statement-breakpoint
DROP INDEX "budget_lines_property_code_uq";--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scope_items" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_email_uq" ON "profiles" USING btree ("email") WHERE "profiles"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_lines_property_code_uq" ON "budget_lines" USING btree ("property_id","cost_code_id") WHERE "budget_lines"."archived_at" is null;