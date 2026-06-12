ALTER TABLE "group_purchases" ADD COLUMN IF NOT EXISTS "details_message_chat_id" bigint;
ALTER TABLE "group_purchases" ADD COLUMN IF NOT EXISTS "details_message_id" bigint;
