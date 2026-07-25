CREATE TYPE "public"."project_phase" AS ENUM('precon', 'in_process', 'punch', 'complete');--> statement-breakpoint
CREATE TYPE "public"."scope_item_status" AS ENUM('not_started', 'in_progress', 'complete', 'blocked');--> statement-breakpoint
CREATE TABLE "project_milestones" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"label" text NOT NULL,
	"phase" "project_phase",
	"planned_date" date,
	"actual_date" date,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "scope_items" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "scope_items" ADD COLUMN "status" "scope_item_status" DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_milestones_project_idx" ON "project_milestones" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "site_audits_project_idx" ON "site_audits" USING btree ("project_id");