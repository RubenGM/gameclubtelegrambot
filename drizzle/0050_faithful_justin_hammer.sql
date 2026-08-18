CREATE TABLE "catalog_pending_games" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"normalized_name" varchar(255) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"detected_by_telegram_user_id" bigint NOT NULL,
	"detected_count" integer DEFAULT 1 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_failure_type" varchar(32),
	"last_failure_message" text,
	"candidates" jsonb,
	"last_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_pending_games" ADD CONSTRAINT "catalog_pending_games_detected_by_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("detected_by_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_pending_games_normalized_name_unique" ON "catalog_pending_games" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "catalog_pending_games_updated_at_idx" ON "catalog_pending_games" USING btree ("updated_at");