ALTER TABLE "properties" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_slug_unique" UNIQUE("slug");