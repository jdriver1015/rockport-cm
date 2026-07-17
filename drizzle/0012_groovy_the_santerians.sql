CREATE TYPE "public"."rent_roll_batch_status" AS ENUM('uploaded', 'parsing', 'needs_review', 'committed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."rent_roll_unit_status" AS ENUM('occupied', 'notice', 'vacant', 'future');--> statement-breakpoint
CREATE TABLE "rent_roll_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"storage_path" text,
	"source_system" text,
	"file_kind" text,
	"status" "rent_roll_batch_status" DEFAULT 'uploaded' NOT NULL,
	"as_of_date" date,
	"row_count" integer DEFAULT 0 NOT NULL,
	"occupied_count" integer DEFAULT 0 NOT NULL,
	"vacant_count" integer DEFAULT 0 NOT NULL,
	"notice_count" integer DEFAULT 0 NOT NULL,
	"occupancy_pct" numeric(5, 2),
	"total_market_rent" numeric(12, 2),
	"total_in_place_rent" numeric(12, 2),
	"loss_to_lease" numeric(12, 2),
	"parse_method" text,
	"confidence_score" integer,
	"parse_progress" jsonb,
	"parse_attempts" integer DEFAULT 0 NOT NULL,
	"warnings" jsonb,
	"extracted_meta" jsonb,
	"error_message" text,
	"uploaded_by" uuid,
	"committed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rent_roll_formats" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_system" text,
	"fingerprint" text NOT NULL,
	"column_mapping" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rent_roll_mapping_examples" (
	"id" serial PRIMARY KEY NOT NULL,
	"raw_label" text NOT NULL,
	"mapped_to" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rent_roll_units" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"batch_id" integer NOT NULL,
	"unit_number" text NOT NULL,
	"floor_plan_code" text,
	"beds" integer,
	"baths" numeric(4, 1),
	"square_feet" integer,
	"market_rent" numeric(10, 2),
	"in_place_rent" numeric(10, 2),
	"lease_start" date,
	"lease_end" date,
	"move_in_date" date,
	"move_out_date" date,
	"status" "rent_roll_unit_status" DEFAULT 'vacant' NOT NULL,
	"resident_name" text,
	"resident_id" text,
	"unit_notes" text,
	"needs_review" boolean DEFAULT false NOT NULL,
	"review_note" text,
	"source_row" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rent_roll_batches" ADD CONSTRAINT "rent_roll_batches_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_roll_batches" ADD CONSTRAINT "rent_roll_batches_uploaded_by_profiles_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_roll_formats" ADD CONSTRAINT "rent_roll_formats_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_roll_mapping_examples" ADD CONSTRAINT "rent_roll_mapping_examples_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_roll_units" ADD CONSTRAINT "rent_roll_units_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_roll_units" ADD CONSTRAINT "rent_roll_units_batch_id_rent_roll_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."rent_roll_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rent_roll_batches_property_idx" ON "rent_roll_batches" USING btree ("property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rent_roll_formats_fingerprint_uq" ON "rent_roll_formats" USING btree ("fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "rent_roll_mapping_examples_uq" ON "rent_roll_mapping_examples" USING btree ("raw_label","mapped_to");--> statement-breakpoint
CREATE INDEX "rent_roll_units_property_batch_idx" ON "rent_roll_units" USING btree ("property_id","batch_id");--> statement-breakpoint
CREATE INDEX "rent_roll_units_batch_idx" ON "rent_roll_units" USING btree ("batch_id");