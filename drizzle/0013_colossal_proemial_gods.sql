CREATE TABLE "charts_of_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "cost_categories" DROP CONSTRAINT "cost_categories_code_unique";--> statement-breakpoint
ALTER TABLE "cost_codes" DROP CONSTRAINT "cost_codes_code_unique";--> statement-breakpoint
ALTER TABLE "cost_categories" ADD COLUMN "chart_id" integer;--> statement-breakpoint
ALTER TABLE "cost_codes" ADD COLUMN "chart_id" integer;--> statement-breakpoint
ALTER TABLE "mapping_rules" ADD COLUMN "chart_id" integer;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "chart_of_accounts_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "charts_of_accounts_default_uq" ON "charts_of_accounts" USING btree ("is_default") WHERE "charts_of_accounts"."is_default" = true and "charts_of_accounts"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "cost_categories" ADD CONSTRAINT "cost_categories_chart_id_charts_of_accounts_id_fk" FOREIGN KEY ("chart_id") REFERENCES "public"."charts_of_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_codes" ADD CONSTRAINT "cost_codes_chart_id_charts_of_accounts_id_fk" FOREIGN KEY ("chart_id") REFERENCES "public"."charts_of_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_rules" ADD CONSTRAINT "mapping_rules_chart_id_charts_of_accounts_id_fk" FOREIGN KEY ("chart_id") REFERENCES "public"."charts_of_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_chart_of_accounts_id_charts_of_accounts_id_fk" FOREIGN KEY ("chart_of_accounts_id") REFERENCES "public"."charts_of_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cost_categories_chart_code_uq" ON "cost_categories" USING btree ("chart_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_codes_chart_code_uq" ON "cost_codes" USING btree ("chart_id","code");