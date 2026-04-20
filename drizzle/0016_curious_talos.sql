CREATE TABLE "group_purchases" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"purchase_mode" varchar(16) NOT NULL,
	"lifecycle_status" varchar(16) DEFAULT 'open' NOT NULL,
	"created_by_telegram_user_id" bigint NOT NULL,
	"join_deadline_at" timestamp with time zone,
	"confirm_deadline_at" timestamp with time zone,
	"total_price_cents" integer,
	"unit_price_cents" integer,
	"unit_label" varchar(64),
	"allocation_field_key" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "group_purchases_created_by_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("created_by_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "group_purchase_fields" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"purchase_id" bigint NOT NULL,
	"field_key" varchar(128) NOT NULL,
	"label" varchar(255) NOT NULL,
	"field_type" varchar(32) NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"config" jsonb,
	"affects_quantity" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_purchase_fields_purchase_id_group_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."group_purchases"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "group_purchase_participants" (
	"purchase_id" bigint NOT NULL,
	"participant_telegram_user_id" bigint NOT NULL,
	"status" varchar(16) DEFAULT 'interested' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "group_purchase_participants_purchase_id_group_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."group_purchases"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "group_purchase_participants_participant_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("participant_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "group_purchase_participant_field_values" (
	"purchase_id" bigint NOT NULL,
	"participant_telegram_user_id" bigint NOT NULL,
	"field_id" bigint NOT NULL,
	"value" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_purchase_participant_field_values_purchase_id_group_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."group_purchases"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "group_purchase_participant_field_values_participant_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("participant_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "group_purchase_participant_field_values_field_id_group_purchase_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."group_purchase_fields"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "group_purchase_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"purchase_id" bigint NOT NULL,
	"author_telegram_user_id" bigint NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_purchase_messages_purchase_id_group_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."group_purchases"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "group_purchase_messages_author_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("author_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "group_purchases_lifecycle_status_idx" ON "group_purchases" USING btree ("lifecycle_status");--> statement-breakpoint
CREATE INDEX "group_purchases_created_by_telegram_user_id_idx" ON "group_purchases" USING btree ("created_by_telegram_user_id");--> statement-breakpoint
CREATE INDEX "group_purchases_join_deadline_at_idx" ON "group_purchases" USING btree ("join_deadline_at");--> statement-breakpoint
CREATE INDEX "group_purchases_confirm_deadline_at_idx" ON "group_purchases" USING btree ("confirm_deadline_at");--> statement-breakpoint
CREATE INDEX "group_purchase_fields_purchase_id_idx" ON "group_purchase_fields" USING btree ("purchase_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_purchase_fields_purchase_field_key_unique" ON "group_purchase_fields" USING btree ("purchase_id","field_key");--> statement-breakpoint
CREATE UNIQUE INDEX "group_purchase_participants_purchase_user_unique" ON "group_purchase_participants" USING btree ("purchase_id","participant_telegram_user_id");--> statement-breakpoint
CREATE INDEX "group_purchase_participants_purchase_id_idx" ON "group_purchase_participants" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "group_purchase_participants_status_idx" ON "group_purchase_participants" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "group_purchase_participant_field_values_unique" ON "group_purchase_participant_field_values" USING btree ("purchase_id","participant_telegram_user_id","field_id");--> statement-breakpoint
CREATE INDEX "group_purchase_participant_field_values_purchase_id_idx" ON "group_purchase_participant_field_values" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "group_purchase_messages_purchase_id_idx" ON "group_purchase_messages" USING btree ("purchase_id");
