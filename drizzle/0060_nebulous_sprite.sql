CREATE TABLE "budget_line_activity_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"budget_line_id" integer NOT NULL,
	"user_id" uuid,
	"field" text NOT NULL,
	"field_label" text NOT NULL,
	"from_value" text,
	"to_value" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_line_activity_log" ADD CONSTRAINT "budget_line_activity_log_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_line_activity_log" ADD CONSTRAINT "budget_line_activity_log_budget_line_id_budget_lines_id_fk" FOREIGN KEY ("budget_line_id") REFERENCES "public"."budget_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_line_activity_log" ADD CONSTRAINT "budget_line_activity_log_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_line_activity_log_property_idx" ON "budget_line_activity_log" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "budget_line_activity_log_line_idx" ON "budget_line_activity_log" USING btree ("budget_line_id");