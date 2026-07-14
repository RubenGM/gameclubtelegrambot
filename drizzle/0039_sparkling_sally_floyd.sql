CREATE TABLE "role_game_character_attachments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"character_id" bigint NOT NULL,
	"internal_storage_entry_id" bigint NOT NULL,
	"visibility" varchar(16) NOT NULL,
	"uploaded_by_telegram_user_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by_telegram_user_id" bigint
);
--> statement-breakpoint
CREATE TABLE "role_game_character_claim_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"character_id" bigint NOT NULL,
	"requested_by_member_id" bigint NOT NULL,
	"status" varchar(16) DEFAULT 'requested' NOT NULL,
	"resolved_by_telegram_user_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "role_game_characters" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"role_game_id" bigint NOT NULL,
	"assigned_member_id" bigint,
	"name" varchar(120) NOT NULL,
	"description" text,
	"external_url" varchar(2048),
	"visibility" varchar(16) NOT NULL,
	"created_by_telegram_user_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_at" timestamp with time zone,
	"unassigned_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "role_game_character_attachments" ADD CONSTRAINT "role_game_character_attachments_character_id_role_game_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."role_game_characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_character_attachments" ADD CONSTRAINT "role_game_character_attachments_internal_storage_entry_id_storage_entries_id_fk" FOREIGN KEY ("internal_storage_entry_id") REFERENCES "public"."storage_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_character_attachments" ADD CONSTRAINT "role_game_character_attachments_uploaded_by_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("uploaded_by_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_character_attachments" ADD CONSTRAINT "role_game_character_attachments_removed_by_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("removed_by_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_character_claim_requests" ADD CONSTRAINT "role_game_character_claim_requests_character_id_role_game_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."role_game_characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_character_claim_requests" ADD CONSTRAINT "role_game_character_claim_requests_requested_by_member_id_role_game_members_id_fk" FOREIGN KEY ("requested_by_member_id") REFERENCES "public"."role_game_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_character_claim_requests" ADD CONSTRAINT "role_game_character_claim_requests_resolved_by_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("resolved_by_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_characters" ADD CONSTRAINT "role_game_characters_role_game_id_role_games_id_fk" FOREIGN KEY ("role_game_id") REFERENCES "public"."role_games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_characters" ADD CONSTRAINT "role_game_characters_assigned_member_id_role_game_members_id_fk" FOREIGN KEY ("assigned_member_id") REFERENCES "public"."role_game_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_characters" ADD CONSTRAINT "role_game_characters_created_by_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("created_by_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "role_game_character_attachments_character_id_idx" ON "role_game_character_attachments" USING btree ("character_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_game_character_attachments_storage_entry_id_idx" ON "role_game_character_attachments" USING btree ("internal_storage_entry_id");--> statement-breakpoint
CREATE INDEX "role_game_character_attachments_active_character_idx" ON "role_game_character_attachments" USING btree ("character_id") WHERE "role_game_character_attachments"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "role_game_character_claims_character_id_idx" ON "role_game_character_claim_requests" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "role_game_character_claims_member_id_idx" ON "role_game_character_claim_requests" USING btree ("requested_by_member_id");--> statement-breakpoint
CREATE INDEX "role_game_character_claims_status_idx" ON "role_game_character_claim_requests" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "role_game_character_claims_one_pending_idx" ON "role_game_character_claim_requests" USING btree ("character_id","requested_by_member_id") WHERE "role_game_character_claim_requests"."status" = 'requested';--> statement-breakpoint
CREATE INDEX "role_game_characters_role_game_id_idx" ON "role_game_characters" USING btree ("role_game_id");--> statement-breakpoint
CREATE INDEX "role_game_characters_assigned_member_id_idx" ON "role_game_characters" USING btree ("assigned_member_id");--> statement-breakpoint
CREATE INDEX "role_game_characters_visibility_idx" ON "role_game_characters" USING btree ("visibility");--> statement-breakpoint
ALTER TABLE "role_game_members" DROP COLUMN "character_name";