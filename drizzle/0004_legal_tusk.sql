CREATE TABLE "club_tables" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"description" text,
	"recommended_capacity" integer,
	"lifecycle_status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone
);
