ALTER TABLE "role_game_notion_sources" ADD COLUMN "token_owner_telegram_user_id" bigint;--> statement-breakpoint
ALTER TABLE "role_game_notion_sources" ADD COLUMN "encrypted_api_token" text;--> statement-breakpoint
ALTER TABLE "role_game_notion_sources" ADD COLUMN "webhook_path_secret" varchar(128);--> statement-breakpoint
ALTER TABLE "role_game_notion_sources" ADD COLUMN "encrypted_webhook_verification_token" text;--> statement-breakpoint
ALTER TABLE "role_game_notion_sources" ADD CONSTRAINT "role_game_notion_sources_token_owner_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("token_owner_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "role_game_notion_sources_webhook_path_unique" ON "role_game_notion_sources" USING btree ("webhook_path_secret") WHERE "role_game_notion_sources"."webhook_path_secret" is not null;