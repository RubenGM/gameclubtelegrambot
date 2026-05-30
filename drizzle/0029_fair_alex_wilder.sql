CREATE TABLE "member_signup_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"telegram_alias" varchar(128),
	"contact" varchar(255) NOT NULL,
	"message" text,
	"accepted_terms" boolean DEFAULT false NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"source" varchar(32) DEFAULT 'web' NOT NULL,
	"user_agent" text,
	"remote_address" varchar(128),
	"notification_summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "member_signup_requests_status_idx" ON "member_signup_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "member_signup_requests_created_at_idx" ON "member_signup_requests" USING btree ("created_at");