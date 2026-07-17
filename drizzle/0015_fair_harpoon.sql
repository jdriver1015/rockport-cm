CREATE TYPE "public"."pricing_method" AS ENUM('sqft', 'fixed', 'per_bedroom', 'per_bathroom', 'per_window', 'per_cabinet', 'percent', 'formula');--> statement-breakpoint
CREATE TABLE "scope_group_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope_group_id" integer NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"pricing_method" "pricing_method" DEFAULT 'fixed' NOT NULL,
	"unit_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"default_quantity" numeric(12, 2),
	"quantity_formula" text,
	"cost_code_id" integer,
	"labor_assumptions" text,
	"material_assumptions" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scope_group_template_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"pricing_method" "pricing_method" DEFAULT 'fixed' NOT NULL,
	"unit_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"default_quantity" numeric(12, 2),
	"quantity_formula" text,
	"cost_code_ref" text,
	"labor_assumptions" text,
	"material_assumptions" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scope_group_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scope_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"source_template_id" integer,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "pre_walk_date" date;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "target_completion_date" date;--> statement-breakpoint
ALTER TABLE "scope_items" ADD COLUMN "cost_code_id" integer;--> statement-breakpoint
ALTER TABLE "scope_items" ADD COLUMN "pricing_method" "pricing_method";--> statement-breakpoint
ALTER TABLE "scope_items" ADD COLUMN "unit_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "scope_items" ADD COLUMN "quantity" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "scope_items" ADD COLUMN "source_group_item_id" integer;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "baths" numeric(4, 1);--> statement-breakpoint
ALTER TABLE "scope_group_items" ADD CONSTRAINT "scope_group_items_scope_group_id_scope_groups_id_fk" FOREIGN KEY ("scope_group_id") REFERENCES "public"."scope_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_group_items" ADD CONSTRAINT "scope_group_items_cost_code_id_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_group_template_items" ADD CONSTRAINT "scope_group_template_items_template_id_scope_group_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."scope_group_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_groups" ADD CONSTRAINT "scope_groups_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_groups" ADD CONSTRAINT "scope_groups_source_template_id_scope_group_templates_id_fk" FOREIGN KEY ("source_template_id") REFERENCES "public"."scope_group_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scope_group_items_group_idx" ON "scope_group_items" USING btree ("scope_group_id");--> statement-breakpoint
CREATE INDEX "scope_group_template_items_template_idx" ON "scope_group_template_items" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "scope_groups_property_idx" ON "scope_groups" USING btree ("property_id");--> statement-breakpoint
ALTER TABLE "scope_items" ADD CONSTRAINT "scope_items_cost_code_id_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_codes"("id") ON DELETE no action ON UPDATE no action;