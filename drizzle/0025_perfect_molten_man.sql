CREATE TABLE "catalog_loan_reminders" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"loan_id" bigint NOT NULL,
	"borrower_telegram_user_id" bigint NOT NULL,
	"reminder_kind" varchar(32) NOT NULL,
	"lead_hours" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_loan_reminders" ADD CONSTRAINT "catalog_loan_reminders_loan_id_catalog_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."catalog_loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_loan_reminders" ADD CONSTRAINT "catalog_loan_reminders_borrower_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("borrower_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_loan_reminders_unique_delivery" ON "catalog_loan_reminders" USING btree ("loan_id","borrower_telegram_user_id","reminder_kind","lead_hours");--> statement-breakpoint
CREATE INDEX "catalog_loan_reminders_loan_id_idx" ON "catalog_loan_reminders" USING btree ("loan_id");--> statement-breakpoint
CREATE INDEX "catalog_loan_reminders_borrower_telegram_user_id_idx" ON "catalog_loan_reminders" USING btree ("borrower_telegram_user_id");