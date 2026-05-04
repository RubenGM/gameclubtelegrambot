CREATE TABLE "schedule_event_reminders" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"schedule_event_id" bigint NOT NULL,
	"participant_telegram_user_id" bigint NOT NULL,
	"lead_hours" integer NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schedule_event_reminders" ADD CONSTRAINT "schedule_event_reminders_schedule_event_id_schedule_events_id_fk" FOREIGN KEY ("schedule_event_id") REFERENCES "public"."schedule_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_event_reminders" ADD CONSTRAINT "schedule_event_reminders_participant_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("participant_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_event_reminders_unique_delivery" ON "schedule_event_reminders" USING btree ("schedule_event_id","participant_telegram_user_id","lead_hours");--> statement-breakpoint
CREATE INDEX "schedule_event_reminders_schedule_event_id_idx" ON "schedule_event_reminders" USING btree ("schedule_event_id");--> statement-breakpoint
CREATE INDEX "schedule_event_reminders_participant_telegram_user_id_idx" ON "schedule_event_reminders" USING btree ("participant_telegram_user_id");