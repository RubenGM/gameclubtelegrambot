CREATE TABLE "user_status_audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"subject_telegram_user_id" bigint NOT NULL,
	"previous_status" varchar(16),
	"next_status" varchar(16) NOT NULL,
	"changed_by_telegram_user_id" bigint NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
