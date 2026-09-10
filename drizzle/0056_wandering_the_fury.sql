ALTER TYPE "public"."attachment_kind" ADD VALUE 'bid';--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "bid_id" integer;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."bids"("id") ON DELETE no action ON UPDATE no action;