# F-009 Group Purchase Deadline Reminders

## Goal

Send private reminders to group purchase participants who are still pending confirmation before the confirmation deadline expires.

## Scope

- Send reminders 24 hours before `confirmDeadlineAt`.
- Target only open group purchases.
- Target only participants with status `interested`.
- Do not notify participants already `confirmed`, `paid`, `delivered`, or `removed`.
- Do not send join-deadline reminders to non-participants because the bot has no reliable private recipient list for people who have not joined.
- Do not add user-configurable reminder preferences in this feature; broader notification preferences remain part of `F-013`.

## Architecture

- Add a `group_purchase_reminders` table that records delivered reminders by purchase, participant, reminder kind, and lead hours.
- Add a group purchase reminder repository for checking and recording sent reminders.
- Add a reminder service that scans open purchases whose `confirmDeadlineAt` is within the configured lead window and sends private messages to pending participants.
- Start the worker from `createApp`, following the existing schedule reminder worker pattern.

## Message Behavior

- The reminder is sent through private Telegram messages.
- The message includes the purchase title and confirmation deadline.
- Text is localized for Catalan, Spanish, and English.
- If delivery fails, the reminder is not recorded, allowing a later retry.

## Data Flow

1. Worker ticks every minute.
2. Service lists open group purchases with `confirmDeadlineAt` between now and now plus 24 hours.
3. For each purchase, service lists participants.
4. Service filters to `interested` participants.
5. Service skips reminders already recorded for that participant and purchase.
6. Service sends the private message.
7. Service records successful sends.

## Testing

- Unit test sends reminders to interested participants inside the 24-hour window.
- Unit test skips non-pending participant statuses.
- Unit test skips already recorded reminders.
- Unit test does not record failed sends.
- Store test persists and checks reminder records.
- App lifecycle test verifies the worker is wired consistently with existing workers if needed.
