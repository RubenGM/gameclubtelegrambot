ALTER TABLE "schedule_events" ADD COLUMN "attendance_mode" varchar(16) DEFAULT 'open' NOT NULL;
ALTER TABLE "schedule_events" ADD COLUMN "initial_occupied_seats" integer DEFAULT 0 NOT NULL;
