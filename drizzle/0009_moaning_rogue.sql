CREATE TABLE "catalog_families" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"slug" varchar(128) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"description" text,
	"family_kind" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_families_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"family_id" bigint,
	"item_type" varchar(32) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"original_name" varchar(255),
	"description" text,
	"language" varchar(64),
	"publisher" varchar(255),
	"publication_year" integer,
	"player_count_min" integer,
	"player_count_max" integer,
	"recommended_age" integer,
	"play_time_minutes" integer,
	"external_refs" jsonb,
	"metadata" jsonb,
	"lifecycle_status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "catalog_media" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"family_id" bigint,
	"item_id" bigint,
	"media_type" varchar(32) NOT NULL,
	"url" text NOT NULL,
	"alt_text" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_family_id_catalog_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."catalog_families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_media" ADD CONSTRAINT "catalog_media_family_id_catalog_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."catalog_families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_media" ADD CONSTRAINT "catalog_media_item_id_catalog_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."catalog_items"("id") ON DELETE no action ON UPDATE no action;