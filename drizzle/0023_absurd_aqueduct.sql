ALTER TABLE "storage_entries" DROP CONSTRAINT "storage_entries_category_id_storage_categories_id_fk";
--> statement-breakpoint
ALTER TABLE "storage_entry_messages" DROP CONSTRAINT "storage_entry_messages_entry_id_storage_entries_id_fk";
--> statement-breakpoint
ALTER TABLE "storage_entries" ADD CONSTRAINT "storage_entries_category_id_storage_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."storage_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_entry_messages" ADD CONSTRAINT "storage_entry_messages_entry_id_storage_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."storage_entries"("id") ON DELETE cascade ON UPDATE no action;