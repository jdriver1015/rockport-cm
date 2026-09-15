CREATE TABLE "vendor_rate_agreement_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"agreement_id" integer NOT NULL,
	"cost_code_id" integer NOT NULL,
	"pricing_method" "pricing_method" DEFAULT 'fixed' NOT NULL,
	"unit_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"default_quantity" numeric(12, 2),
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_rate_agreements" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"budget_group_id" integer NOT NULL,
	"vendor_id" integer NOT NULL,
	"name" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "vendor_rate_agreement_lines" ADD CONSTRAINT "vendor_rate_agreement_lines_agreement_id_vendor_rate_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."vendor_rate_agreements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_rate_agreement_lines" ADD CONSTRAINT "vendor_rate_agreement_lines_cost_code_id_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_rate_agreements" ADD CONSTRAINT "vendor_rate_agreements_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_rate_agreements" ADD CONSTRAINT "vendor_rate_agreements_budget_group_id_budget_groups_id_fk" FOREIGN KEY ("budget_group_id") REFERENCES "public"."budget_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_rate_agreements" ADD CONSTRAINT "vendor_rate_agreements_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_rate_agreements" ADD CONSTRAINT "vendor_rate_agreements_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vendor_rate_agreement_lines_agreement_idx" ON "vendor_rate_agreement_lines" USING btree ("agreement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_rate_agreement_lines_agreement_code_uq" ON "vendor_rate_agreement_lines" USING btree ("agreement_id","cost_code_id");--> statement-breakpoint
CREATE INDEX "vendor_rate_agreements_group_idx" ON "vendor_rate_agreements" USING btree ("budget_group_id");--> statement-breakpoint
CREATE INDEX "vendor_rate_agreements_vendor_idx" ON "vendor_rate_agreements" USING btree ("vendor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_rate_agreements_active_uq" ON "vendor_rate_agreements" USING btree ("budget_group_id","vendor_id") WHERE status = 'active';