CREATE TABLE "bid_line_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"bid_id" integer NOT NULL,
	"scope_item_id" integer,
	"description" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bid_line_items" ADD CONSTRAINT "bid_line_items_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."bids"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_line_items" ADD CONSTRAINT "bid_line_items_scope_item_id_scope_items_id_fk" FOREIGN KEY ("scope_item_id") REFERENCES "public"."scope_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" DROP COLUMN "amount";--> statement-breakpoint
ALTER TABLE "scope_items" DROP COLUMN "quantity";--> statement-breakpoint
ALTER TABLE "scope_items" DROP COLUMN "unit_cost";--> statement-breakpoint
ALTER TABLE "scope_items" DROP COLUMN "vendor";--> statement-breakpoint
ALTER TABLE "scope_items" DROP COLUMN "status";