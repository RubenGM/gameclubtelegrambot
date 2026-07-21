WITH duplicate_links AS MATERIALIZED (
	SELECT
		role_game_sessions.id,
		role_game_sessions.schedule_event_id,
		row_number() OVER (
			PARTITION BY role_game_sessions.role_game_id, role_game_sessions.generated_for_starts_at
			ORDER BY CASE WHEN schedule_events.lifecycle_status = 'scheduled' THEN 0 ELSE 1 END, role_game_sessions.id
		) AS occurrence_rank
	FROM role_game_sessions
	INNER JOIN schedule_events ON schedule_events.id = role_game_sessions.schedule_event_id
	WHERE role_game_sessions.generated_for_starts_at IS NOT NULL
), cancelled_events AS (
	UPDATE schedule_events
	SET
		lifecycle_status = 'cancelled',
		cancelled_at = COALESCE(schedule_events.cancelled_at, now()),
		cancellation_reason = COALESCE(schedule_events.cancellation_reason, 'Duplicated recurring role-game occurrence'),
		updated_at = now()
	FROM duplicate_links
	WHERE duplicate_links.occurrence_rank > 1
		AND schedule_events.id = duplicate_links.schedule_event_id
		AND schedule_events.lifecycle_status = 'scheduled'
	RETURNING schedule_events.id
)
DELETE FROM role_game_sessions
USING duplicate_links
WHERE duplicate_links.occurrence_rank > 1
	AND role_game_sessions.id = duplicate_links.id;
--> statement-breakpoint
CREATE UNIQUE INDEX "role_game_sessions_role_game_occurrence_idx" ON "role_game_sessions" USING btree ("role_game_id","generated_for_starts_at");
