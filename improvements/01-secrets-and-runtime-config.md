# Improvement 01: Secrets and Runtime Configuration

## Summary

The project has a solid runtime configuration loader, but the current operational model still centers on JSON files that contain sensitive values such as the Telegram token, database password, and admin elevation hash. That is workable for local bootstrap, but it creates unnecessary exposure in day-to-day development and deployment.

## Why This Matters

- A leaked Telegram bot token gives full control of the bot.
- A leaked database password gives direct access to application data.
- A leaked admin elevation hash increases offline attack risk.
- Secret-bearing JSON files are easy to copy, back up, or inspect accidentally.

## Evidence In This Repository

- `src/config/load-runtime-config.ts:23-69` loads the full runtime configuration from a JSON file.
- `config/runtime.example.json:7-23` shows that the JSON payload includes `telegram.token`, `database.password`, and `adminElevation.passwordHash`.
- `.gitignore:5-7` explicitly ignores `.env.postgres.local`, `config/runtime.local.json`, and `config/runtime.json`, which confirms the normal workflow expects real secret-bearing files to exist in the workspace.
- `scripts/install-debian-stack.sh:200-226` copies runtime config into `/etc/gameclubtelegrambot/runtime.json` and points the service at that file.

## Recommended Fix

1. Keep non-secret structure in `config/runtime.json`.
2. Move runtime secrets to a host-local `.env` file loaded at runtime.
3. Keep real process environment variables as the highest-precedence override.
4. Provide one terminal editor that lets operators edit a single merged model while automatically saving each value to the correct file.
5. Use a proper full-screen TUI instead of the current flat list plus ad-hoc prompt flow.

The approved storage split is:

- `config/runtime.json` for non-secret structure
- `config/.env` for secrets in local repo workflows
- `/etc/gameclubtelegrambot/runtime.json` for deployed non-secret structure
- `/etc/gameclubtelegrambot/.env` for deployed secrets

Secret-backed fields should continue to route to `.env`:

- `telegram.token`
- `bgg.apiKey`
- `database.password`
- `adminElevation.passwordHash`

Non-secret fields stay in JSON:

- bot identity fields
- database host, port, name, user, ssl
- bootstrap identity fields
- notification defaults
- feature flags

## Current Gaps In The Existing Editor

The current implementation solved the storage split, but the TUI itself is still too primitive for operator use:

1. It is not a real multi-pane terminal app.
2. It mixes raw keyboard handling with temporary `readline` prompts.
3. It treats `bot.language` like free text even though the runtime schema only allows `ca`, `es`, or `en`.
4. It validates too late and reports errors too vaguely.
5. It likely rewrites only schema-shaped JSON on save, which risks dropping unrelated keys in existing operator config files.

These issues explain why editing simple fields can feel fragile or crash-prone.

## Approved TUI Rebuild Direction

Rebuild the editor around `blessed`.

Why `blessed`:

- It matches a pane-based terminal app better than a prompt-based approach.
- It provides lists, boxes, focus management, scroll regions, key handling, and modal-friendly widgets.
- It avoids bringing React into the runtime config tool just to render a single admin interface.
- It is a better fit for keyboard-first operator workflows than the current custom ANSI screen.

The target experience is an operator console, not a bootstrap wizard.

## Desired TUI Layout

### Header

Show:

- editor title
- current `runtime.json` path
- current `.env` path
- dirty state
- save status
- validation status

### Left Pane

Use the left side for navigation:

- section list
- field list within the active section
- visible markers for required, optional, dirty, and invalid fields

Suggested sections:

- Bot
- Telegram
- BoardGameGeek
- Database
- Admin elevation
- Bootstrap
- Notifications
- Feature flags

### Right Pane

Use the right side for field details:

- field label
- human description
- where the value is stored: `runtime.json` or `.env`
- whether it is secret-backed
- allowed values or constraints
- example value when useful
- current value preview
- field-level validation errors

### Footer / Status Bar

Show:

- hotkeys
- transient status messages
- save feedback
- validation summary

## Desired Editing Model

The editor should stop using temporary `readline` prompts.

Instead, it should keep one state-driven `blessed` screen active for the entire session, with modal editors opened inside that screen.

### Keybindings

Keep navigation conventional:

- arrow keys to move
- `Tab` and `Shift-Tab` to switch panes
- `Enter` to open or confirm an editor
- `Space` to toggle booleans
- `Esc` to cancel the active modal or edit
- `Ctrl-S` to save
- `q` to quit
- `/` to search fields

### Field Types

The field metadata layer should become richer so the UI knows how each field must behave.

At minimum, fields should support:

- `string`
- `secret`
- `number`
- `boolean`
- `enum`
- `json`

Additional metadata should include:

- `description`
- `required`
- `destination`
- `secret`
- `options` for enums
- numeric bounds where applicable
- display formatter
- parser/validator hooks when useful

### Specific Field Behaviors

- `bot.language` must be an enum picker with `ca`, `es`, `en`
- booleans should toggle directly
- secret fields must be masked while displayed and while entered
- number fields should validate bounds before commit
- JSON fields such as `featureFlags` should open in a dedicated modal editor with parse feedback
- optional fields should support an explicit clear action

## Validation Requirements

Validation must become interactive instead of only running at final save.

The new TUI should:

1. Validate fields when the user commits an edit.
2. Recompute full-config validation after each confirmed change.
3. Show field-level errors inline in the detail pane.
4. Keep a global validation summary in the footer or a dedicated error area.
5. Focus the first invalid field when save fails.
6. Never eject the user from the TUI because of normal bad input.

Validation must still enforce the runtime schema constraints:

- required secrets present
- enum values valid
- number ranges respected
- booleans valid
- JSON parseable when edited

## Persistence Requirements

This part is as important as the UI refresh.

The editor must preserve operator-managed data that is outside the current schema-shaped object.

### JSON Save Rules

On save:

1. Start from the original parsed JSON object, not only the in-memory schema-shaped draft.
2. Update only the managed JSON-backed paths.
3. Remove secret-backed fields from JSON.
4. Prune empty objects only when they became empty because secret-backed values moved out.
5. Preserve unrelated keys that may already exist in operator files.

### `.env` Save Rules

On save:

1. Preserve unrelated lines and comments when possible.
2. Update only managed secret keys.
3. Keep values in standard `KEY=value` form.
4. Continue using atomic temp-file-then-rename writes.

### Migration Rules

If legacy `runtime.json` files still contain secret values, the editor should:

1. import them into the merged in-memory model
2. write them into `.env` on the next save
3. remove them from JSON during that same save

This provides a one-pass migration without forcing manual file surgery.

## Implementation Plan

### Phase 1: Dependency And Metadata Foundation

1. Add `blessed` as a dependency.
2. Refactor runtime config field definitions so they describe true editor behavior instead of only storage routing.
3. Promote `bot.language` to an enum field backed by one canonical option list.
4. Attach field descriptions, destination labels, required flags, and constraints.

### Phase 2: State Model

1. Introduce explicit editor state:

- original JSON object
- original `.env` text
- merged working draft
- dirty field set
- touched field set
- field-level errors
- active pane
- active modal
- search query and filtered fields

2. Replace the current single `lastError` string with structured state.

### Phase 3: Blessed Layout Shell

1. Build a real `blessed` screen.
2. Add header, navigation pane, detail pane, and footer/status widgets.
3. Support resize-safe layout refreshes.
4. Keep the screen active throughout the session instead of swapping modes.

### Phase 4: Typed Editors

1. Implement enum picker modal.
2. Implement masked secret input modal.
3. Implement bounded number input modal.
4. Implement string input modal.
5. Implement boolean toggling in-place.
6. Implement JSON modal with parse validation.

### Phase 5: Validation And Search

1. Validate on edit commit.
2. Maintain a live validation summary.
3. Add field search.
4. Add quick navigation to the next invalid field.
5. Prevent save when the config is invalid, while keeping the user in-context.

### Phase 6: Persistence Hardening

1. Update save logic to patch managed JSON paths into the original parsed object.
2. Preserve unrelated JSON keys.
3. Preserve unrelated `.env` lines.
4. Keep secret-backed fields out of JSON.
5. Keep atomic write guarantees.

### Phase 7: Verification

1. Rebuild the project.
2. Run the required deployment verification via `./startup.sh`.
3. Confirm the editor still works in init and edit modes.

## Suggested Implementation Steps

1. Replace the current flat editor UI rather than continuing to patch it.
2. Start with metadata and persistence safety before polishing visuals.
3. Make the language selector the first enum field delivered, because it is the clearest current failure point.
4. Add the visual polish only after the editor is structurally sound.
5. Keep the root wrapper script and npm entrypoints unchanged so operators do not have to relearn commands.

## Expected Outcome

- Safer local development and Debian deployment.
- A TUI that feels like an operator console instead of a bootstrap prompt.
- Clearer validation and fewer crash-like failures.
- Preservation of unrelated operator-managed config values.
- A one-pass migration path from legacy secret-in-JSON configs to `.env`-backed secrets.
