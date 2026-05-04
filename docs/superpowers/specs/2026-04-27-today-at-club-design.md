# Today At Club Design

## Goal

Add a concise `Avui al club` summary to the private `/start` experience so approved members immediately see what is happening today without adding another main-menu button.

## Scope

- Show the summary only in private chats for approved users.
- Keep pending-user and group `/start` replies unchanged.
- Include activities that start today.
- Include venue events that overlap today.
- Show a short empty-state line when nothing is registered for today.
- Do not include table availability, group-purchase deadlines, or personal loans in this first version.

## User Experience

The existing start message remains first. For approved users, append a compact HTML block:

```text
Avui al club
Activitats:
- 16:00 Wingspan
Local:
- 18:00-21:00 Torneig intern
```

If there is no activity or venue event today, show:

```text
Avui al club
Avui no hi ha activitats ni esdeveniments del local registrats.
```

Texts must be localized for `ca`, `es`, and `en` using the existing Telegram i18n structure.

## Architecture

Create a small Telegram presentation helper for the summary and call it from `buildStartReply` after the existing start message is selected. The helper will load data through existing repositories built from `context.runtime.services.database.db`, then return either a formatted HTML block or `undefined` when the current chat/user should not receive the summary.

The start reply will use `parseMode: 'HTML'` only when the summary is appended. Existing reply-keyboard behavior stays unchanged.

## Data Flow

- Resolve today's UTC day window from the current date.
- Query schedule events with `startsAtFrom` and `startsAtTo` for today, excluding cancelled events.
- Query venue events that overlap the same day window, excluding cancelled events.
- Sort entries by start time.
- Format short list rows with escaped titles/names.

## Error Handling

The summary is best-effort. If loading today data fails, `/start` should still return the existing start message and menu.

## Testing

- Approved private `/start` includes today's activities.
- Approved private `/start` includes today's venue events.
- Approved private `/start` includes the empty state when nothing is registered today.
- Pending users and group starts keep their existing messages.
- Run `npm run typecheck`, relevant tests, full unit tests, and `./startup.sh`.

## Out Of Scope

- New main-menu action or `/today` command.
- Table availability.
- Group-purchase deadlines.
- Personal loan summaries.
