CREATE TYPE "public"."attachment_kind" AS ENUM('photo', 'invoice', 'lien_waiver', 'document');--> statement-breakpoint
CREATE TYPE "public"."batch_status" AS ENUM('uploaded', 'parsed', 'in_review', 'posted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."mapping_match_type" AS ENUM('gl_account', 'vendor', 'keyword');--> statement-breakpoint
CREATE TYPE "public"."project_kind" AS ENUM('unit', 'common');--> statement-breakpoint
CREATE TYPE "public"."project_stage" AS ENUM('planned', 'bidding', 'ready', 'in_progress', 'punch', 'complete', 'invoiced', 'closed');--> statement-breakpoint
CREATE TYPE "public"."punch_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."txn_status" AS ENUM('staged', 'needs_review', 'posted', 'excluded');--> statement-breakpoint
CREATE TYPE "public"."unit_tier" AS ENUM('classic', 'upgraded', 'renovated');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'cm', 'site', 'viewer');--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"project_id" integer,
	"punch_item_id" integer,
	"gl_transaction_id" integer,
	"kind" "attachment_kind" DEFAULT 'photo' NOT NULL,
	"storage_path" text NOT NULL,
	"stage_tag" text,
	"caption" text,
	"taken_at" timestamp with time zone,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bids" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"vendor_id" integer,
	"bid_number" integer DEFAULT 1 NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"received_date" date,
	"approved" boolean DEFAULT false NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "budget_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"cost_code_id" integer NOT NULL,
	"uw_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"per_unit_amount" numeric(12, 2),
	"planned_units" integer,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "cost_categories_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "cost_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_interior" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "cost_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "gl_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"batch_id" integer,
	"cost_code_id" integer,
	"project_id" integer,
	"vendor_id" integer,
	"vendor_raw" text,
	"description" text,
	"amount" numeric(12, 2) NOT NULL,
	"txn_date" date,
	"invoice_no" text,
	"check_no" text,
	"draw_no" text,
	"unit_label" text,
	"gl_account_raw" text,
	"status" "txn_status" DEFAULT 'staged' NOT NULL,
	"exclude_reason" text,
	"source_row" integer,
	"lien_waiver" boolean DEFAULT false NOT NULL,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"storage_path" text,
	"source_system" text,
	"status" "batch_status" DEFAULT 'uploaded' NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"auto_mapped_count" integer DEFAULT 0 NOT NULL,
	"needs_review_count" integer DEFAULT 0 NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mapping_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_type" "mapping_match_type" NOT NULL,
	"pattern" text NOT NULL,
	"cost_code_id" integer NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"full_name" text,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "project_stage_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"from_stage" "project_stage",
	"to_stage" "project_stage" NOT NULL,
	"note" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"name" text NOT NULL,
	"kind" "project_kind" DEFAULT 'common' NOT NULL,
	"cost_code_id" integer,
	"unit_id" integer,
	"stage" "project_stage" DEFAULT 'planned' NOT NULL,
	"budget_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"committed_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"vendor_id" integer,
	"start_date" date,
	"complete_date" date,
	"previous_rent" numeric(10, 2),
	"trade_out_rent" numeric(10, 2),
	"in_place_rent" numeric(10, 2),
	"lease_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"entity" text,
	"address" text,
	"city" text,
	"state" text,
	"unit_count" integer,
	"pm_system" text,
	"gl_updated_thru" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "punch_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"description" text NOT NULL,
	"status" "punch_status" DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"unit_number" text NOT NULL,
	"floorplan" text,
	"bedrooms" integer,
	"sqft" integer,
	"tier" "unit_tier" DEFAULT 'classic' NOT NULL,
	"occupied" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"trade" text,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendors_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_punch_item_id_punch_items_id_fk" FOREIGN KEY ("punch_item_id") REFERENCES "public"."punch_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_gl_transaction_id_gl_transactions_id_fk" FOREIGN KEY ("gl_transaction_id") REFERENCES "public"."gl_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_profiles_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_cost_code_id_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_codes" ADD CONSTRAINT "cost_codes_category_id_cost_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."cost_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_transactions" ADD CONSTRAINT "gl_transactions_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_transactions" ADD CONSTRAINT "gl_transactions_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_transactions" ADD CONSTRAINT "gl_transactions_cost_code_id_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_transactions" ADD CONSTRAINT "gl_transactions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_transactions" ADD CONSTRAINT "gl_transactions_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploaded_by_profiles_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_rules" ADD CONSTRAINT "mapping_rules_cost_code_id_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stage_events" ADD CONSTRAINT "project_stage_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stage_events" ADD CONSTRAINT "project_stage_events_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_cost_code_id_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_items" ADD CONSTRAINT "punch_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_lines_property_code_uq" ON "budget_lines" USING btree ("property_id","cost_code_id");--> statement-breakpoint
CREATE UNIQUE INDEX "units_property_number_uq" ON "units" USING btree ("property_id","unit_number");