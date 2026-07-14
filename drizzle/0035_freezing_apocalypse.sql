CREATE TABLE "print_jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"requested_by_telegram_user_id" bigint NOT NULL,
	"requested_by_display_name" varchar(255) NOT NULL,
	"origin" varchar(32) NOT NULL,
	"storage_entry_id" bigint,
	"storage_message_id" bigint,
	"original_file_name" text NOT NULL,
	"mime_type" text,
	"detected_type" varchar(32) NOT NULL,
	"normalized_page_count" integer NOT NULL,
	"selected_pages_label" varchar(255) NOT NULL,
	"selected_page_count" integer NOT NULL,
	"copies" integer NOT NULL,
	"estimated_physical_pages" integer NOT NULL,
	"sides" varchar(32) NOT NULL,
	"cups_queue" varchar(255) NOT NULL,
	"status" varchar(16) DEFAULT 'prepared' NOT NULL,
	"cups_job_id" varchar(128),
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_requested_by_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("requested_by_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_storage_entry_id_storage_entries_id_fk" FOREIGN KEY ("storage_entry_id") REFERENCES "public"."storage_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_storage_message_id_storage_entry_messages_id_fk" FOREIGN KEY ("storage_message_id") REFERENCES "public"."storage_entry_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "print_jobs_created_at_idx" ON "print_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "print_jobs_requested_by_telegram_user_id_idx" ON "print_jobs" USING btree ("requested_by_telegram_user_id");--> statement-breakpoint
CREATE INDEX "print_jobs_status_idx" ON "print_jobs" USING btree ("status");