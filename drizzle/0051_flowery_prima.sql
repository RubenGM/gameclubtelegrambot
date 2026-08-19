CREATE TABLE "catalog_loan_news_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"category_key" varchar(128) NOT NULL,
	"action" varchar(16) NOT NULL,
	"item_id" bigint NOT NULL,
	"item_display_name" varchar(255) NOT NULL,
	"user_name" varchar(255) NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "catalog_loan_news_events" ADD CONSTRAINT "catalog_loan_news_events_item_id_catalog_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_loan_news_events_pending_idx" ON "catalog_loan_news_events" USING btree ("occurred_at") WHERE "catalog_loan_news_events"."published_at" is null;