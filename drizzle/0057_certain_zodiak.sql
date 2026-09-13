CREATE INDEX "attachments_bid_idx" ON "attachments" USING btree ("bid_id");--> statement-breakpoint
CREATE INDEX "import_batches_property_idx" ON "import_batches" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "mapping_rules_chart_idx" ON "mapping_rules" USING btree ("chart_id");