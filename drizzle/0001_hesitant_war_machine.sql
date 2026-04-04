CREATE TABLE "users" (
	"telegram_user_id" bigint PRIMARY KEY NOT NULL,
	"username" varchar(64),
	"display_name" varchar(255) NOT NULL,
	"is_approved" boolean DEFAULT false NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone
);
