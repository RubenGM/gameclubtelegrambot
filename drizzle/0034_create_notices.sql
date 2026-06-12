CREATE TABLE "notices" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"created_by_telegram_user_id" bigint NOT NULL,
	"creator_display_name" varchar(255) NOT NULL,
	"text" text NOT NULL,
	"text_html" text,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by_telegram_user_id" bigint,
	"archive_reason" text
);
--> statement-breakpoint
CREATE TABLE "notice_attachments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"notice_id" bigint NOT NULL,
	"source_chat_id" bigint NOT NULL,
	"source_message_id" integer NOT NULL,
	"attachment_kind" varchar(16) NOT NULL,
	"telegram_file_id" text,
	"telegram_file_unique_id" text,
	"caption" text,
	"original_file_name" text,
	"mime_type" text,
	"file_size_bytes" integer,
	"media_group_id" varchar(128),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notice_publications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"notice_id" bigint NOT NULL,
	"chat_id" bigint NOT NULL,
	"message_thread_id" integer DEFAULT 0 NOT NULL,
	"message_id" integer NOT NULL,
	"publication_kind" varchar(16) NOT NULL,
	"attachment_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_created_by_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("created_by_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_archived_by_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("archived_by_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notice_attachments" ADD CONSTRAINT "notice_attachments_notice_id_notices_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."notices"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notice_publications" ADD CONSTRAINT "notice_publications_notice_id_notices_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."notices"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notice_publications" ADD CONSTRAINT "notice_publications_attachment_id_notice_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."notice_attachments"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "notices_status_idx" ON "notices" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "notices_created_by_telegram_user_id_idx" ON "notices" USING btree ("created_by_telegram_user_id");
--> statement-breakpoint
CREATE INDEX "notices_expires_at_idx" ON "notices" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "notices_created_at_idx" ON "notices" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "notice_attachments_notice_id_idx" ON "notice_attachments" USING btree ("notice_id");
--> statement-breakpoint
CREATE INDEX "notice_publications_notice_id_idx" ON "notice_publications" USING btree ("notice_id");
--> statement-breakpoint
CREATE INDEX "notice_publications_destination_idx" ON "notice_publications" USING btree ("chat_id","message_thread_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "notice_publications_message_unique" ON "notice_publications" USING btree ("chat_id","message_id");
