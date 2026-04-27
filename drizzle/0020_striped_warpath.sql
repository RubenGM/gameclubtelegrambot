CREATE TABLE "group_purchase_reminders" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"purchase_id" bigint NOT NULL,
	"participant_telegram_user_id" bigint NOT NULL,
	"reminder_kind" varchar(32) NOT NULL,
	"lead_hours" integer NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group_purchase_reminders" ADD CONSTRAINT "group_purchase_reminders_purchase_id_group_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."group_purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_purchase_reminders" ADD CONSTRAINT "group_purchase_reminders_participant_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("participant_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_purchase_reminders_unique_delivery" ON "group_purchase_reminders" USING btree ("purchase_id","participant_telegram_user_id","reminder_kind","lead_hours");--> statement-breakpoint
CREATE INDEX "group_purchase_reminders_purchase_id_idx" ON "group_purchase_reminders" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "group_purchase_reminders_participant_telegram_user_id_idx" ON "group_purchase_reminders" USING btree ("participant_telegram_user_id");