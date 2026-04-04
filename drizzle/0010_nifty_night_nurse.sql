CREATE TABLE "catalog_groups" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"family_id" bigint,
	"slug" varchar(128) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_groups_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "group_id" bigint;--> statement-breakpoint
ALTER TABLE "catalog_groups" ADD CONSTRAINT "catalog_groups_family_id_catalog_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."catalog_families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_group_id_catalog_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."catalog_groups"("id") ON DELETE no action ON UPDATE no action;