ALTER TABLE "users" ADD COLUMN "status" varchar(16) DEFAULT 'pending' NOT NULL;
ALTER TABLE "users" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "users" ADD COLUMN "blocked_at" timestamp with time zone;
ALTER TABLE "users" ADD COLUMN "status_reason" text;
UPDATE "users" SET "status" = CASE WHEN "is_approved" THEN 'approved' ELSE 'pending' END;

CREATE TABLE "user_permission_assignments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"subject_telegram_user_id" bigint NOT NULL,
	"permission_key" varchar(128) NOT NULL,
	"scope_type" varchar(16) NOT NULL,
	"resource_type" varchar(64),
	"resource_id" varchar(128),
	"effect" varchar(8) NOT NULL,
	"granted_by_telegram_user_id" bigint,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "user_permission_audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"subject_telegram_user_id" bigint NOT NULL,
	"permission_key" varchar(128) NOT NULL,
	"scope_type" varchar(16) NOT NULL,
	"resource_type" varchar(64),
	"resource_id" varchar(128),
	"previous_effect" varchar(8),
	"next_effect" varchar(8),
	"changed_by_telegram_user_id" bigint,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "user_permission_assignments" ADD CONSTRAINT "user_permission_assignments_subject_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("subject_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;
CREATE UNIQUE INDEX "user_permission_assignments_unique_assignment" ON "user_permission_assignments" USING btree ("subject_telegram_user_id","permission_key","scope_type","resource_type","resource_id");
