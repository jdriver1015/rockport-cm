ALTER TABLE "project_stage_events" ADD COLUMN "from_phase" "project_phase";--> statement-breakpoint
ALTER TABLE "project_stage_events" ADD COLUMN "to_phase" "project_phase";--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "phase" "project_phase" DEFAULT 'precon' NOT NULL;