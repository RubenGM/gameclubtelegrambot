# Schedule Event Reminders Design

## Goal

Send private reminders to participants before scheduled activities, using the existing runtime defaults and preventing duplicate reminders across service restarts.

## Scope

- Send reminders only by private Telegram message.
- Send only to active participants of a scheduled activity.
- Use `notifications.defaults.eventRemindersEnabled` to enable or disable the worker.
- Use `notifications.defaults.eventReminderLeadHours` as the lead time.
- Persist successful reminder sends so the same participant does not receive the same reminder twice.
- Do not notify organizers unless they are active participants.
- Do not publish reminders to news groups.

## User Experience

When an activity enters the reminder window, each active participant receives a short message:

```text
Recordatori: Wingspan comença el 27/04 a les 16:00.
```

The first version uses the bot runtime language. Per-user language preferences are out of scope.

## Persistence

Add a `schedule_event_reminders` table with:

- `id`
- `schedule_event_id`
- `participant_telegram_user_id`
- `lead_hours`
- `sent_at`
- `created_at`

Add a unique constraint on `schedule_event_id`, `participant_telegram_user_id`, and `lead_hours`.

This makes reminder delivery idempotent across polling loops, service restarts, and deployments.

## Worker Behavior

- Start the worker when the application starts.
- Stop the worker when the application stops.
- Poll every minute.
- If reminders are disabled, do nothing.
- On each tick, load scheduled activities starting between `now` and `now + leadHours`.
- For each activity, load active participants.
- Skip participant reminders already recorded for that event and lead time.
- Send private messages one participant at a time.
- Record the reminder only after the send succeeds.
- If a send fails, do not record it so the next tick can retry.

## Architecture

Create a small schedule reminder service with two layers:

- A pure orchestration function that accepts repositories, `now`, `leadHours`, and a sender. This is the core unit for tests.
- A worker wrapper that owns `setInterval`, calls the orchestration function, logs errors, and is wired into `createApp`.

The orchestration function should reuse the existing schedule repository for activities and participants, and a new reminder repository for persistence.

## Error Handling

- A failed participant DM must not abort reminders for other participants.
- A failed participant DM must not create a sent record.
- A worker tick failure is logged and the next tick still runs.
- Reminder failures must not stop the Telegram bot or database connection.

## Testing

- Sends reminders for events inside the lead-time window.
- Does not send reminders for events outside the window.
- Sends only to active participants.
- Skips reminders already recorded in DB.
- Records a reminder only after a successful send.
- Does not record failed sends.
- Worker respects `eventRemindersEnabled`.
- App startup starts the worker and app shutdown stops it.
- Run `npm run typecheck`, focused reminder tests, full unit tests, and `./startup.sh`.

## Out Of Scope

- Per-user reminder preferences.
- Per-event reminder overrides.
- Group reminders.
- Organizer-only reminders.
- Admin UI for reminder settings.
