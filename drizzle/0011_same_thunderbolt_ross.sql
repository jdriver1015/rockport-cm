CREATE TYPE "public"."audit_status" AS ENUM('draft', 'complete');--> statement-breakpoint
CREATE TYPE "public"."finding_severity" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."finding_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TABLE "audit_findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"audit_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"location" text,
	"severity" "finding_severity" DEFAULT 'medium' NOT NULL,
	"status" "finding_status" DEFAULT 'open' NOT NULL,
	"assignee" text,
	"due_date" date,
	"sort_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"finding_id" integer NOT NULL,
	"storage_path" text NOT NULL,
	"annotated_path" text,
	"annotation" jsonb,
	"caption" text,
	"sort_index" integer DEFAULT 0 NOT NULL,
	"taken_at" timestamp with time zone,
	"gps_lat" numeric(9, 6),
	"gps_lng" numeric(9, 6),
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "site_audits" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"project_id" integer,
	"title" text NOT NULL,
	"audit_date" date NOT NULL,
	"auditor_name" text,
	"notes" text,
	"status" "audit_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_audit_id_site_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."site_audits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_photos" ADD CONSTRAINT "audit_photos_finding_id_audit_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."audit_findings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_photos" ADD CONSTRAINT "audit_photos_uploaded_by_profiles_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_audits" ADD CONSTRAINT "site_audits_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_audits" ADD CONSTRAINT "site_audits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_audits" ADD CONSTRAINT "site_audits_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_findings_audit_idx" ON "audit_findings" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX "audit_photos_finding_idx" ON "audit_photos" USING btree ("finding_id");--> statement-breakpoint
CREATE INDEX "site_audits_property_idx" ON "site_audits" USING btree ("property_id");