CREATE TABLE "catalog_loans" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"item_id" bigint NOT NULL,
	"borrower_telegram_user_id" bigint NOT NULL,
	"borrower_display_name" varchar(255) NOT NULL,
	"loaned_by_telegram_user_id" bigint NOT NULL,
	"due_at" timestamp with time zone,
	"notes" text,
	"returned_at" timestamp with time zone,
	"returned_by_telegram_user_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_loans" ADD CONSTRAINT "catalog_loans_item_id_catalog_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_loans" ADD CONSTRAINT "catalog_loans_borrower_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("borrower_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_loans" ADD CONSTRAINT "catalog_loans_loaned_by_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("loaned_by_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_loans" ADD CONSTRAINT "catalog_loans_returned_by_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("returned_by_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_loans_item_id_idx" ON "catalog_loans" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "catalog_loans_borrower_telegram_user_id_idx" ON "catalog_loans" USING btree ("borrower_telegram_user_id");