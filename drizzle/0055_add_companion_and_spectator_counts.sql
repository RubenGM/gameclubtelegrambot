ALTER TABLE "schedule_event_participants" ADD COLUMN "companion_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_event_participants" ADD COLUMN "spectator_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "schedule_event_participants" SET "spectator_count" = "guest_count";--> statement-breakpoint
ALTER TABLE "schedule_event_participants" DROP CONSTRAINT IF EXISTS "schedule_event_participants_guest_count_non_negative";--> statement-breakpoint
ALTER TABLE "schedule_event_participants" DROP COLUMN "guest_count";--> statement-breakpoint
ALTER TABLE "schedule_event_participants" ADD CONSTRAINT "schedule_event_participants_companion_count_non_negative" CHECK ("schedule_event_participants"."companion_count" >= 0);--> statement-breakpoint
ALTER TABLE "schedule_event_participants" ADD CONSTRAINT "schedule_event_participants_spectator_count_non_negative" CHECK ("schedule_event_participants"."spectator_count" >= 0);
