ALTER TABLE "catalog_pending_games" ADD COLUMN "source_telegram_chat_id" bigint;--> statement-breakpoint
ALTER TABLE "catalog_pending_games" ADD COLUMN "source_telegram_message_id" bigint;