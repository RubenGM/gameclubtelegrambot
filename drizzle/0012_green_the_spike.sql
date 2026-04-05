CREATE TABLE "news_group_subscriptions" (
	"chat_id" bigint NOT NULL,
	"category_key" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_groups" (
	"chat_id" bigint PRIMARY KEY NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enabled_at" timestamp with time zone,
	"disabled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "news_group_subscriptions" ADD CONSTRAINT "news_group_subscriptions_chat_id_news_groups_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."news_groups"("chat_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "news_group_subscriptions_unique_subscription" ON "news_group_subscriptions" USING btree ("chat_id","category_key");--> statement-breakpoint
CREATE INDEX "news_group_subscriptions_category_key_idx" ON "news_group_subscriptions" USING btree ("category_key");--> statement-breakpoint
CREATE INDEX "news_groups_is_enabled_idx" ON "news_groups" USING btree ("is_enabled");