# Catalog Loan Activity Warning Design

## Goal

Warn members when they create an activity from a catalog board game that is currently loaned out, without blocking activity creation.

## Scope

- Applies only to the `Crear partida` / `Create activity` action from a board-game catalog item detail.
- If the item has no active loan, keep the current behavior unchanged.
- If the item has an active loan, prepend a localized warning to the existing date prompt.
- Continue starting the same `schedule-create` session at the `date` step with `data: { title: item.displayName }`.
- Do not add confirmation buttons or block the flow.

## User Experience

When a loan exists, the bot replies with a warning before asking for the activity date:

```text
Atencio: aquest joc esta prestat a Marta fins 10/05. Pots continuar creant l'activitat igualment.

Escriu la data d'inici...
```

If the loan has no due date, the warning omits the date and only names the borrower.

Texts are localized for `ca`, `es`, and `en` using the existing catalog i18n files.

## Architecture

Extend the existing `catalog_admin:create_activity:` callback branch in `catalog-admin-support.ts`. After loading the board-game item and before replying with the schedule date prompt, load the active loan through the existing catalog loan repository. Format a small warning string when a loan exists and prepend it to the prompt.

No new flow key, repository method, database table, or button is needed.

## Error Handling

The loan warning is best-effort for user guidance. If the loan lookup fails, the bot should keep the current activity-creation behavior and show only the date prompt.

## Testing

- Active loan: starts `schedule-create`, keeps `stepKey: date`, and includes the warning with borrower and due date.
- Active loan without due date: warning names the borrower without a misleading date.
- No active loan: starts the flow and keeps the current date prompt without warning.
- Non-board-game items keep the existing behavior.
- Run focused catalog tests, `npm run typecheck`, `npm run test:unit`, and `./startup.sh`.

## Out Of Scope

- Blocking activity creation.
- Adding `Continuar` / `Tornar` confirmation buttons.
- Checking family/group-level availability.
- Warning for manually created activities that are not launched from a catalog item.
