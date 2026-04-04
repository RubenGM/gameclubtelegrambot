CREATE TABLE "schedule_event_participants" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"schedule_event_id" bigint NOT NULL,
	"participant_telegram_user_id" bigint NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"added_by_telegram_user_id" bigint NOT NULL,
	"removed_by_telegram_user_id" bigint,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "schedule_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"organizer_telegram_user_id" bigint NOT NULL,
	"created_by_telegram_user_id" bigint NOT NULL,
	"table_id" bigint,
	"capacity" integer NOT NULL,
	"lifecycle_status" varchar(16) DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_telegram_user_id" bigint,
	"cancellation_reason" text
);
--> statement-breakpoint
ALTER TABLE "schedule_event_participants" ADD CONSTRAINT "schedule_event_participants_schedule_event_id_schedule_events_id_fk" FOREIGN KEY ("schedule_event_id") REFERENCES "public"."schedule_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_event_participants" ADD CONSTRAINT "schedule_event_participants_participant_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("participant_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_event_participants" ADD CONSTRAINT "schedule_event_participants_added_by_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("added_by_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_event_participants" ADD CONSTRAINT "schedule_event_participants_removed_by_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("removed_by_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_events" ADD CONSTRAINT "schedule_events_organizer_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("organizer_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_events" ADD CONSTRAINT "schedule_events_created_by_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("created_by_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_events" ADD CONSTRAINT "schedule_events_table_id_club_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."club_tables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_events" ADD CONSTRAINT "schedule_events_cancelled_by_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("cancelled_by_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_event_participants_unique_participant" ON "schedule_event_participants" USING btree ("schedule_event_id","participant_telegram_user_id");