ALTER TYPE "public"."batch_status" ADD VALUE 'needs_mapping' BEFORE 'in_review';--> statement-breakpoint
ALTER TYPE "public"."batch_status" ADD VALUE 'needs_accounts' BEFORE 'in_review';--> statement-breakpoint
CREATE TABLE "gl_import_formats" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_system" text,
	"fingerprint" text NOT NULL,
	"column_mapping" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gl_property_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"account_code" text NOT NULL,
	"account_name" text,
	"is_construction" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "period_date" date;--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "account_summary" jsonb;--> statement-breakpoint
ALTER TABLE "gl_import_formats" ADD CONSTRAINT "gl_import_formats_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_property_accounts" ADD CONSTRAINT "gl_property_accounts_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gl_import_formats_fingerprint_uq" ON "gl_import_formats" USING btree ("fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "gl_property_accounts_uq" ON "gl_property_accounts" USING btree ("property_id","account_code");