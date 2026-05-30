ALTER TABLE "news_group_subscriptions" ADD COLUMN "message_thread_id" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DROP INDEX "news_group_subscriptions_unique_subscription";--> statement-breakpoint
CREATE UNIQUE INDEX "news_group_subscriptions_unique_subscription" ON "news_group_subscriptions" USING btree ("chat_id","category_key","message_thread_id");
