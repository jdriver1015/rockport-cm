CREATE TYPE "public"."attendee_role" AS ENUM('organizer', 'required', 'optional');--> statement-breakpoint
CREATE TABLE "audit_attendees" (
	"id" serial PRIMARY KEY NOT NULL,
	"audit_id" integer NOT NULL,
	"profile_id" uuid,
	"vendor_contact_id" integer,
	"role" "attendee_role" DEFAULT 'required' NOT NULL,
	"invited_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_attendees_one_identity_ck" CHECK (("audit_attendees"."profile_id" is null) <> ("audit_attendees"."vendor_contact_id" is null))
);
--> statement-breakpoint
ALTER TABLE "audit_photos" ALTER COLUMN "finding_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_photos" ADD COLUMN "audit_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "punch_walk_date" date;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "punch_walk_time" time;--> statement-breakpoint
ALTER TABLE "site_audits" ADD COLUMN "walk_time" time;--> statement-breakpoint
ALTER TABLE "audit_attendees" ADD CONSTRAINT "audit_attendees_audit_id_site_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."site_audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_attendees" ADD CONSTRAINT "audit_attendees_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_attendees" ADD CONSTRAINT "audit_attendees_vendor_contact_id_vendor_contacts_id_fk" FOREIGN KEY ("vendor_contact_id") REFERENCES "public"."vendor_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_attendees_audit_idx" ON "audit_attendees" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX "audit_attendees_profile_idx" ON "audit_attendees" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_attendees_profile_uq" ON "audit_attendees" USING btree ("audit_id","profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_attendees_vendor_contact_uq" ON "audit_attendees" USING btree ("audit_id","vendor_contact_id");--> statement-breakpoint
ALTER TABLE "audit_photos" ADD CONSTRAINT "audit_photos_audit_id_site_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."site_audits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_photos_audit_idx" ON "audit_photos" USING btree ("audit_id");