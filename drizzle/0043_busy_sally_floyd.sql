CREATE TABLE "role_game_notion_changes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_id" bigint NOT NULL,
	"source_page_id" bigint,
	"webhook_event_id" bigint,
	"change_kind" varchar(32) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"notion_last_edited_at" timestamp with time zone,
	"details" jsonb,
	"error" text,
	"reviewed_by_telegram_user_id" bigint,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_game_notion_page_revisions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_page_id" bigint NOT NULL,
	"role_game_material_id" bigint,
	"revision_kind" varchar(16) NOT NULL,
	"notion_last_edited_at" timestamp with time zone,
	"content_hash" varchar(128),
	"block_ids" jsonb,
	"rendered_content" text,
	"captured_by_telegram_user_id" bigint,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_game_notion_source_pages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_id" bigint NOT NULL,
	"notion_page_id" varchar(128) NOT NULL,
	"parent_notion_page_id" varchar(128),
	"page_url" varchar(2048) NOT NULL,
	"title" varchar(255),
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"last_notion_edited_at" timestamp with time zone,
	"latest_content_fingerprint" varchar(128),
	"latest_role_game_material_id" bigint,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_imported_at" timestamp with time zone,
	"last_imported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_game_notion_sources" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"role_game_id" bigint NOT NULL,
	"root_page_id" varchar(128) NOT NULL,
	"root_page_url" varchar(2048) NOT NULL,
	"title" varchar(255),
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"linked_by_telegram_user_id" bigint NOT NULL,
	"last_notion_edited_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"last_webhook_event_id" varchar(255),
	"last_webhook_event_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_game_notion_webhook_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" varchar(255) NOT NULL,
	"source_id" bigint,
	"source_page_id" bigint,
	"notion_page_id" varchar(128),
	"event_type" varchar(128) NOT NULL,
	"entity_type" varchar(64),
	"occurred_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_fingerprint" varchar(128),
	"status" varchar(16) DEFAULT 'received' NOT NULL,
	"error" text,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "role_game_notion_changes" ADD CONSTRAINT "role_game_notion_changes_source_id_role_game_notion_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."role_game_notion_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_notion_changes" ADD CONSTRAINT "role_game_notion_changes_source_page_id_role_game_notion_source_pages_id_fk" FOREIGN KEY ("source_page_id") REFERENCES "public"."role_game_notion_source_pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_notion_changes" ADD CONSTRAINT "role_game_notion_changes_webhook_event_id_role_game_notion_webhook_events_id_fk" FOREIGN KEY ("webhook_event_id") REFERENCES "public"."role_game_notion_webhook_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_notion_changes" ADD CONSTRAINT "role_game_notion_changes_reviewed_by_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("reviewed_by_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_notion_page_revisions" ADD CONSTRAINT "role_game_notion_page_revisions_source_page_id_role_game_notion_source_pages_id_fk" FOREIGN KEY ("source_page_id") REFERENCES "public"."role_game_notion_source_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_notion_page_revisions" ADD CONSTRAINT "role_game_notion_page_revisions_role_game_material_id_role_game_materials_id_fk" FOREIGN KEY ("role_game_material_id") REFERENCES "public"."role_game_materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_notion_page_revisions" ADD CONSTRAINT "role_game_notion_page_revisions_captured_by_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("captured_by_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_notion_source_pages" ADD CONSTRAINT "role_game_notion_source_pages_source_id_role_game_notion_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."role_game_notion_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_notion_source_pages" ADD CONSTRAINT "role_game_notion_source_pages_latest_role_game_material_id_role_game_materials_id_fk" FOREIGN KEY ("latest_role_game_material_id") REFERENCES "public"."role_game_materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_notion_sources" ADD CONSTRAINT "role_game_notion_sources_role_game_id_role_games_id_fk" FOREIGN KEY ("role_game_id") REFERENCES "public"."role_games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_notion_sources" ADD CONSTRAINT "role_game_notion_sources_linked_by_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("linked_by_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_notion_webhook_events" ADD CONSTRAINT "role_game_notion_webhook_events_source_id_role_game_notion_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."role_game_notion_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_notion_webhook_events" ADD CONSTRAINT "role_game_notion_webhook_events_source_page_id_role_game_notion_source_pages_id_fk" FOREIGN KEY ("source_page_id") REFERENCES "public"."role_game_notion_source_pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "role_game_notion_changes_webhook_event_id_unique" ON "role_game_notion_changes" USING btree ("webhook_event_id") WHERE "role_game_notion_changes"."webhook_event_id" is not null;--> statement-breakpoint
CREATE INDEX "role_game_notion_changes_source_status_idx" ON "role_game_notion_changes" USING btree ("source_id","status");--> statement-breakpoint
CREATE INDEX "role_game_notion_changes_source_page_id_idx" ON "role_game_notion_changes" USING btree ("source_page_id");--> statement-breakpoint
CREATE INDEX "role_game_notion_page_revisions_source_page_id_idx" ON "role_game_notion_page_revisions" USING btree ("source_page_id");--> statement-breakpoint
CREATE INDEX "role_game_notion_page_revisions_material_id_idx" ON "role_game_notion_page_revisions" USING btree ("role_game_material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_game_notion_page_revisions_source_page_hash_unique" ON "role_game_notion_page_revisions" USING btree ("source_page_id","content_hash") WHERE "role_game_notion_page_revisions"."content_hash" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "role_game_notion_source_pages_source_page_unique" ON "role_game_notion_source_pages" USING btree ("source_id","notion_page_id");--> statement-breakpoint
CREATE INDEX "role_game_notion_source_pages_notion_page_id_idx" ON "role_game_notion_source_pages" USING btree ("notion_page_id");--> statement-breakpoint
CREATE INDEX "role_game_notion_source_pages_source_id_idx" ON "role_game_notion_source_pages" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "role_game_notion_source_pages_latest_material_id_idx" ON "role_game_notion_source_pages" USING btree ("latest_role_game_material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_game_notion_sources_role_game_id_unique" ON "role_game_notion_sources" USING btree ("role_game_id");--> statement-breakpoint
CREATE INDEX "role_game_notion_sources_root_page_id_idx" ON "role_game_notion_sources" USING btree ("root_page_id");--> statement-breakpoint
CREATE INDEX "role_game_notion_sources_status_idx" ON "role_game_notion_sources" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "role_game_notion_webhook_events_event_id_unique" ON "role_game_notion_webhook_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "role_game_notion_webhook_events_source_id_idx" ON "role_game_notion_webhook_events" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "role_game_notion_webhook_events_notion_page_id_idx" ON "role_game_notion_webhook_events" USING btree ("notion_page_id");--> statement-breakpoint
CREATE INDEX "role_game_notion_webhook_events_status_idx" ON "role_game_notion_webhook_events" USING btree ("status");