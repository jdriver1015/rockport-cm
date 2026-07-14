CREATE INDEX "attachments_project_idx" ON "attachments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "bid_line_items_bid_idx" ON "bid_line_items" USING btree ("bid_id");--> statement-breakpoint
CREATE INDEX "bids_project_idx" ON "bids" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "cost_codes_category_idx" ON "cost_codes" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "gl_txn_property_status_idx" ON "gl_transactions" USING btree ("property_id","status");--> statement-breakpoint
CREATE INDEX "gl_txn_batch_idx" ON "gl_transactions" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "gl_txn_project_idx" ON "gl_transactions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "gl_txn_cost_code_idx" ON "gl_transactions" USING btree ("cost_code_id");--> statement-breakpoint
CREATE INDEX "project_stage_events_project_idx" ON "project_stage_events" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "projects_property_idx" ON "projects" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "projects_cost_code_idx" ON "projects" USING btree ("cost_code_id");--> statement-breakpoint
CREATE INDEX "punch_items_project_idx" ON "punch_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "scope_items_project_idx" ON "scope_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "vendor_contacts_vendor_idx" ON "vendor_contacts" USING btree ("vendor_id");