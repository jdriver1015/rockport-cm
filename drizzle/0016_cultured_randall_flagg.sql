ALTER TABLE "scope_group_items" ADD COLUMN "is_alternate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "scope_group_items" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "scope_group_items" ADD COLUMN "product_link" text;--> statement-breakpoint
ALTER TABLE "scope_group_template_items" ADD COLUMN "is_alternate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "scope_group_template_items" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "scope_group_template_items" ADD COLUMN "product_link" text;