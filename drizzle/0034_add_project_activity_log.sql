-- General-purpose field-change log for a project (see src/lib/actions/activity-log.ts).
-- project_stage_events (phase-only) stays as-is, read-only, for history predating this table.
CREATE TABLE "project_activity_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"user_id" uuid,
	"field" text NOT NULL,
	"field_label" text NOT NULL,
	"from_value" text,
	"to_value" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_activity_log" ADD CONSTRAINT "project_activity_log_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_activity_log" ADD CONSTRAINT "project_activity_log_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "project_activity_log_project_idx" ON "project_activity_log" USING btree ("project_id");
--> statement-breakpoint
-- Every other table has RLS enabled with no policies (see 0026_enable_rls_all_tables.sql) —
-- this table needs the same lockout of the PostgREST anon/authenticated surface.
ALTER TABLE "project_activity_log" ENABLE ROW LEVEL SECURITY;
