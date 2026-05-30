ALTER TABLE "schedule_events" ADD COLUMN "catalog_item_id" bigint;--> statement-breakpoint
ALTER TABLE "schedule_events" ADD CONSTRAINT "schedule_events_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedule_events_catalog_item_id_idx" ON "schedule_events" USING btree ("catalog_item_id");
