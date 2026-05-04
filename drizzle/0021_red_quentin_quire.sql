CREATE TABLE "lfg_group_ads" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"created_by_telegram_user_id" bigint NOT NULL,
	"creator_display_name" varchar(255) NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"seats_available" integer,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lfg_player_ads" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"telegram_user_id" bigint NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "lfg_group_ads" ADD CONSTRAINT "lfg_group_ads_created_by_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("created_by_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lfg_player_ads" ADD CONSTRAINT "lfg_player_ads_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lfg_group_ads_status_idx" ON "lfg_group_ads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "lfg_group_ads_created_by_telegram_user_id_idx" ON "lfg_group_ads" USING btree ("created_by_telegram_user_id");--> statement-breakpoint
CREATE INDEX "lfg_group_ads_updated_at_idx" ON "lfg_group_ads" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "lfg_player_ads_status_idx" ON "lfg_player_ads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "lfg_player_ads_telegram_user_id_idx" ON "lfg_player_ads" USING btree ("telegram_user_id");--> statement-breakpoint
CREATE INDEX "lfg_player_ads_updated_at_idx" ON "lfg_player_ads" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lfg_player_ads_one_active_per_user" ON "lfg_player_ads" USING btree ("telegram_user_id") WHERE "lfg_player_ads"."status" = 'active';