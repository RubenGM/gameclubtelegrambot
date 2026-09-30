ALTER TABLE "schedule_events" ADD COLUMN "is_priority" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_events" ADD COLUMN "priority_explanation" text;