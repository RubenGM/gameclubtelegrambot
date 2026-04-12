# Telegram Runtime Resilience Design

## Goal

Eliminate silent Telegram outages by treating unexpected long-polling failure after startup as a fatal runtime error that stops the service and lets `systemd` restart it.

## Background

The current Telegram startup flow validates the bot token and starts polling successfully, but the polling lifecycle is not owned after startup. If `bot.start()` later rejects, the error is only logged.

That leaves the Node process alive while Telegram update processing is effectively dead. Because `systemd` only restarts the service when the process exits, this creates a silent outage.

## Scope

### In scope

- Detect unexpected Telegram polling failure after startup.
- Propagate that failure to the service runner as an application-level fatal event.
- Reuse the existing shutdown path so the process exits with code `1`.
- Preserve idempotent shutdown if a signal arrives during fatal shutdown.
- Add tests for startup success, runtime failure, and intentional shutdown.

### Out of scope

- New health-check endpoints.
- Tray-visible degraded state.
- Retry loops inside the Telegram boundary.
- Changes to `systemd` unit behavior.

## Design Summary

Use an explicit runtime-failure callback from the Telegram boundary to the app and service layers.

Startup failure remains a `TelegramStartupError` and continues to fail fast during `app.start()`.

Post-start polling failure becomes a separate fatal runtime signal. `runService` listens for that signal and invokes its existing fatal shutdown path, which stops the app once and returns exit code `1`.

## Component Changes

### `createGrammyTelegramBot`

The bot adapter should stop discarding the polling lifecycle with `void bot.start(...).catch(...)`.

Instead, it should:

- start polling after `bot.init()`
- keep enough local state to distinguish intentional stop from unexpected failure
- report unexpected `bot.start()` rejection through a provided callback

Intentional shutdown must not report a fatal runtime error.

### `createTelegramBoundary`

The boundary should accept an optional fatal-runtime callback and invoke it at most once when polling fails after startup.

Responsibilities:

- own startup behavior and still throw `TelegramStartupError` for startup failures
- own runtime failure propagation for post-start polling failures
- keep `stop()` safe to call during or after runtime failure handling

The boundary remains the place where Telegram-specific runtime concerns are translated into application-level behavior.

### `createApp`

The app layer should wire Telegram boundary runtime failures upward without adding its own process-management logic.

Recommended change:

- allow the app to accept or expose a fatal-runtime notification callback
- pass that callback into `createTelegramBoundary`

This keeps `createApp` responsible for boundary composition, not shutdown policy.

### `runService`

The service runner should subscribe to app-level fatal runtime events and route them into the existing `shutdown(reason, 1, 'fatal', error)` path.

This preserves the current service behavior:

- one shutdown sequence
- fatal logging through the existing logger
- app stop before exit
- non-zero exit so `systemd` restarts the process

## Data Flow

### Normal startup and steady state

1. `runService` creates the app.
2. `app.start()` starts infrastructure.
3. `app.start()` starts the Telegram boundary.
4. The Telegram boundary authenticates and begins long polling.
5. `runService` waits until a signal or fatal runtime event occurs.

### Unexpected Telegram runtime failure

1. Polling has already started successfully.
2. `bot.start()` rejects unexpectedly.
3. The Grammy bot adapter reports that rejection to the Telegram boundary.
4. The Telegram boundary raises a fatal runtime event to the app/service layer.
5. `runService` triggers fatal shutdown with exit code `1`.
6. `app.stop()` shuts down Telegram and infrastructure once.
7. The process exits and `systemd` restarts it.

### Intentional shutdown

1. `SIGINT` or `SIGTERM` triggers the existing shutdown path.
2. `app.stop()` calls `telegram.stop()`.
3. The Telegram bot stops polling intentionally.
4. No runtime-failure callback is emitted.

## Error Handling Rules

- Telegram startup errors remain startup errors.
- Unexpected post-start polling failure is fatal.
- Intentional polling stop during shutdown is not fatal.
- Fatal runtime reporting must be single-shot to avoid duplicate shutdown attempts.
- If a signal and a runtime failure happen near the same time, `runService`'s existing shutdown guard remains the single source of truth.

## Interface Direction

The exact type shape can stay minimal, but the design needs one explicit callback path.

Recommended shape:

- Telegram boundary creation accepts `onFatalRuntimeError?: (error: unknown) => void`
- App creation accepts the same callback or exposes an equivalent subscription
- Grammy bot adapter uses that callback only for unexpected polling termination after startup

This is preferred over relying on process-global `unhandledRejection`, because it keeps failure propagation explicit and testable.

## Testing

Add or update tests in the existing boundary and bootstrap test files.

### Telegram boundary tests

- startup success still reports `connected`
- unexpected polling rejection after startup calls the fatal-runtime callback once
- intentional `stop()` does not call the fatal-runtime callback

### Service runner tests

- app-level fatal runtime event causes shutdown with exit code `1`
- fatal runtime event logs as fatal and stops the app
- concurrent signal plus fatal runtime event still performs only one shutdown

## Acceptance Criteria

- The process no longer stays alive after Telegram polling dies unexpectedly.
- Unexpected post-start polling failure causes service shutdown with exit code `1`.
- Intentional shutdown does not get misclassified as a fatal runtime error.
- Shutdown remains idempotent under overlapping signal and runtime-failure conditions.
- The design stays minimal and does not add retry loops or new operator surfaces.
