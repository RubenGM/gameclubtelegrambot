CREATE TABLE "storage_categories" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"slug" varchar(128) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"description" text,
	"storage_chat_id" bigint NOT NULL,
	"storage_thread_id" integer NOT NULL,
	"lifecycle_status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "storage_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"category_id" bigint NOT NULL,
	"created_by_telegram_user_id" bigint NOT NULL,
	"source_kind" varchar(16) NOT NULL,
	"description" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lifecycle_status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_telegram_user_id" bigint
);
--> statement-breakpoint
CREATE TABLE "storage_entry_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entry_id" bigint NOT NULL,
	"storage_chat_id" bigint NOT NULL,
	"storage_message_id" integer NOT NULL,
	"storage_thread_id" integer NOT NULL,
	"telegram_file_id" text,
	"telegram_file_unique_id" text,
	"attachment_kind" varchar(16) NOT NULL,
	"caption" text,
	"original_file_name" text,
	"mime_type" text,
	"file_size_bytes" integer,
	"media_group_id" varchar(128),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "storage_entries" ADD CONSTRAINT "storage_entries_category_id_storage_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."storage_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_entries" ADD CONSTRAINT "storage_entries_created_by_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("created_by_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_entries" ADD CONSTRAINT "storage_entries_deleted_by_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("deleted_by_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_entry_messages" ADD CONSTRAINT "storage_entry_messages_entry_id_storage_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."storage_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "storage_categories_slug_unique" ON "storage_categories" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_categories_storage_topic_unique" ON "storage_categories" USING btree ("storage_chat_id","storage_thread_id");--> statement-breakpoint
CREATE INDEX "storage_categories_lifecycle_status_idx" ON "storage_categories" USING btree ("lifecycle_status");--> statement-breakpoint
CREATE INDEX "storage_entries_category_id_idx" ON "storage_entries" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "storage_entries_lifecycle_status_idx" ON "storage_entries" USING btree ("lifecycle_status");--> statement-breakpoint
CREATE INDEX "storage_entries_created_by_telegram_user_id_idx" ON "storage_entries" USING btree ("created_by_telegram_user_id");--> statement-breakpoint
CREATE INDEX "storage_entry_messages_entry_id_idx" ON "storage_entry_messages" USING btree ("entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_entry_messages_storage_message_unique" ON "storage_entry_messages" USING btree ("storage_chat_id","storage_message_id");--> statement-breakpoint
CREATE INDEX "storage_entry_messages_telegram_file_unique_id_idx" ON "storage_entry_messages" USING btree ("telegram_file_unique_id");