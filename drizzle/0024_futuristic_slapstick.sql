CREATE TABLE "storage_category_subscriptions" (
	"telegram_user_id" bigint NOT NULL,
	"category_id" bigint NOT NULL,
	"include_subcategories" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "storage_category_subscriptions" ADD CONSTRAINT "storage_category_subscriptions_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_category_subscriptions" ADD CONSTRAINT "storage_category_subscriptions_category_id_storage_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."storage_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "storage_category_subscriptions_unique_subscription" ON "storage_category_subscriptions" USING btree ("telegram_user_id","category_id");--> statement-breakpoint
CREATE INDEX "storage_category_subscriptions_category_id_idx" ON "storage_category_subscriptions" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "storage_category_subscriptions_telegram_user_id_idx" ON "storage_category_subscriptions" USING btree ("telegram_user_id");