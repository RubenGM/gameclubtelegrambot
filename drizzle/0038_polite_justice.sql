CREATE TABLE "role_game_material_deliveries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"role_game_material_id" bigint NOT NULL,
	"recipient_telegram_user_id" bigint NOT NULL,
	"sent_by_telegram_user_id" bigint NOT NULL,
	"delivery_mode" varchar(16) NOT NULL,
	"status" varchar(16) NOT NULL,
	"error_code" varchar(64),
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_game_materials" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"role_game_id" bigint NOT NULL,
	"internal_storage_entry_id" bigint NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"visibility" varchar(16) NOT NULL,
	"delivery_state" varchar(16) DEFAULT 'not_sent' NOT NULL,
	"uploaded_by_telegram_user_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revealed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "role_game_members" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"role_game_id" bigint NOT NULL,
	"telegram_user_id" bigint NOT NULL,
	"role" varchar(16) NOT NULL,
	"status" varchar(16) NOT NULL,
	"is_external" boolean DEFAULT false NOT NULL,
	"character_name" varchar(120),
	"player_note" text,
	"requested_by_telegram_user_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_game_sessions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"role_game_id" bigint NOT NULL,
	"schedule_event_id" bigint NOT NULL,
	"source" varchar(24) NOT NULL,
	"generated_for_starts_at" timestamp with time zone,
	"created_by_telegram_user_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_games" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"title" varchar(255) NOT NULL,
	"system" varchar(120) NOT NULL,
	"description" text,
	"visibility" varchar(16) DEFAULT 'members' NOT NULL,
	"public_join_policy" varchar(32) DEFAULT 'members_only' NOT NULL,
	"entry_mode" varchar(16) DEFAULT 'request' NOT NULL,
	"acceptance_mode" varchar(24) DEFAULT 'manual_review' NOT NULL,
	"capacity" integer NOT NULL,
	"primary_gm_telegram_user_id" bigint NOT NULL,
	"default_duration_minutes" integer DEFAULT 180 NOT NULL,
	"default_table_id" bigint,
	"default_attendance_mode" varchar(16) DEFAULT 'closed' NOT NULL,
	"default_is_public_schedule_event" boolean DEFAULT false NOT NULL,
	"auto_add_confirmed_players" boolean DEFAULT false NOT NULL,
	"allow_player_manual_scheduling" boolean DEFAULT false NOT NULL,
	"scheduling_mode" varchar(16) DEFAULT 'manual' NOT NULL,
	"recurrence_rule" jsonb,
	"recurrence_window_count" integer DEFAULT 0 NOT NULL,
	"created_by_telegram_user_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "role_game_material_deliveries" ADD CONSTRAINT "role_game_material_deliveries_role_game_material_id_role_game_materials_id_fk" FOREIGN KEY ("role_game_material_id") REFERENCES "public"."role_game_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_material_deliveries" ADD CONSTRAINT "role_game_material_deliveries_recipient_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("recipient_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_material_deliveries" ADD CONSTRAINT "role_game_material_deliveries_sent_by_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("sent_by_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_materials" ADD CONSTRAINT "role_game_materials_role_game_id_role_games_id_fk" FOREIGN KEY ("role_game_id") REFERENCES "public"."role_games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_materials" ADD CONSTRAINT "role_game_materials_internal_storage_entry_id_storage_entries_id_fk" FOREIGN KEY ("internal_storage_entry_id") REFERENCES "public"."storage_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_materials" ADD CONSTRAINT "role_game_materials_uploaded_by_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("uploaded_by_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_members" ADD CONSTRAINT "role_game_members_role_game_id_role_games_id_fk" FOREIGN KEY ("role_game_id") REFERENCES "public"."role_games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_members" ADD CONSTRAINT "role_game_members_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_members" ADD CONSTRAINT "role_game_members_requested_by_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("requested_by_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_sessions" ADD CONSTRAINT "role_game_sessions_role_game_id_role_games_id_fk" FOREIGN KEY ("role_game_id") REFERENCES "public"."role_games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_sessions" ADD CONSTRAINT "role_game_sessions_schedule_event_id_schedule_events_id_fk" FOREIGN KEY ("schedule_event_id") REFERENCES "public"."schedule_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_sessions" ADD CONSTRAINT "role_game_sessions_created_by_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("created_by_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_games" ADD CONSTRAINT "role_games_primary_gm_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("primary_gm_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_games" ADD CONSTRAINT "role_games_default_table_id_club_tables_id_fk" FOREIGN KEY ("default_table_id") REFERENCES "public"."club_tables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_games" ADD CONSTRAINT "role_games_created_by_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("created_by_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "role_game_material_deliveries_material_id_idx" ON "role_game_material_deliveries" USING btree ("role_game_material_id");--> statement-breakpoint
CREATE INDEX "role_game_material_deliveries_recipient_telegram_user_id_idx" ON "role_game_material_deliveries" USING btree ("recipient_telegram_user_id");--> statement-breakpoint
CREATE INDEX "role_game_materials_role_game_id_idx" ON "role_game_materials" USING btree ("role_game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_game_materials_internal_storage_entry_id_idx" ON "role_game_materials" USING btree ("internal_storage_entry_id");--> statement-breakpoint
CREATE INDEX "role_game_members_role_game_id_idx" ON "role_game_members" USING btree ("role_game_id");--> statement-breakpoint
CREATE INDEX "role_game_members_telegram_user_id_idx" ON "role_game_members" USING btree ("telegram_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_game_members_one_primary_gm" ON "role_game_members" USING btree ("role_game_id") WHERE "role_game_members"."role" = 'primary_gm' and "role_game_members"."status" in ('invited', 'requested', 'confirmed', 'waitlisted');--> statement-breakpoint
CREATE UNIQUE INDEX "role_game_members_one_active_user_membership" ON "role_game_members" USING btree ("role_game_id","telegram_user_id") WHERE "role_game_members"."status" in ('invited', 'requested', 'confirmed', 'waitlisted');--> statement-breakpoint
CREATE INDEX "role_game_sessions_role_game_id_idx" ON "role_game_sessions" USING btree ("role_game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_game_sessions_schedule_event_id_idx" ON "role_game_sessions" USING btree ("schedule_event_id");--> statement-breakpoint
CREATE INDEX "role_games_status_idx" ON "role_games" USING btree ("status");--> statement-breakpoint
CREATE INDEX "role_games_visibility_idx" ON "role_games" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "role_games_primary_gm_idx" ON "role_games" USING btree ("primary_gm_telegram_user_id");