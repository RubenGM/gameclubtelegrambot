CREATE TABLE "club_equipment" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"description" text,
	"lifecycle_status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "schedule_event_equipment" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"schedule_event_id" bigint NOT NULL,
	"equipment_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schedule_event_equipment" ADD CONSTRAINT "schedule_event_equipment_schedule_event_id_schedule_events_id_fk" FOREIGN KEY ("schedule_event_id") REFERENCES "public"."schedule_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_event_equipment" ADD CONSTRAINT "schedule_event_equipment_equipment_id_club_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."club_equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_event_equipment_unique_assignment" ON "schedule_event_equipment" USING btree ("schedule_event_id","equipment_id");--> statement-breakpoint
CREATE INDEX "schedule_event_equipment_equipment_id_idx" ON "schedule_event_equipment" USING btree ("equipment_id");