# Telegram Hardening Plan

## Goal

Reduce Telegram runtime fragility and hot-path database cost without changing the bot's functional behavior.

## Source Documents

- `docs/superpowers/specs/2026-04-12-telegram-runtime-resilience-design.md`
- `docs/superpowers/specs/2026-04-12-database-integrity-concurrency-design.md`
- `docs/runtime-configuration.md`

This plan reuses the same design principles already established in the project:

- explicit runtime failure propagation instead of silent degradation
- focused, minimal changes at the boundary closest to the problem
- concurrency and persistence fixes at the real source of truth, not only in friendly application paths

## Current Findings

### 1. Callback acknowledgements are not guaranteed

Current code in `src/telegram/runtime-boundary-support.ts` answers callback queries only after the handler completes successfully.

Risk:

- a failing callback handler can leave the Telegram client spinner active
- the user may receive an error message in chat but still experience a broken interaction

### 2. Expired conversation cleanup runs on every update

Current code in `src/telegram/conversation-session.ts` calls `deleteExpiredSessions()` during session runtime load, and `src/telegram/conversation-session-store.ts` implements that as a full prefix scan.

Risk:

- every Telegram update pays an ever-growing cleanup cost
- session throughput degrades as stored session count grows
- unrelated updates do background maintenance work in the hot path

### 3. User profile sync writes to the database on every update

Current code in `src/telegram/runtime-boundary-middleware.ts` calls `syncUserProfile()` before actor load for every update, and `src/membership/access-flow-store.ts` performs a read plus update even when the profile did not change.

Risk:

- unnecessary write load on the hottest Telegram path
- extra row churn and contention in `users`
- higher latency before every command, text message, and callback reaches business logic

### 4. Runtime context recreates import services per update

Current code in `src/telegram/runtime-boundary-middleware.ts` creates the BoardGameGeek/Wikipedia import service inside the per-update runtime context middleware.

Risk:

- repeated object creation in the hot path
- unnecessary coupling between update handling and service construction

### 5. Telegram observability is too thin for production diagnosis

Current logging in `src/telegram/runtime-boundary-middleware.ts` captures only generic update receipt and generic failure state.

Risk:

- difficult root-cause analysis for failed commands and callbacks
- weak visibility into latency, handler type, chat context, and user impact

## Hardening Principles

- Keep changes small and behavior-preserving.
- Fix boundary mechanics before refactoring deeper flows.
- Remove hot-path work before adding more logging or UX polish.
- Prefer explicit failure handling over hidden fallbacks.
- Keep runtime secrets and deploy behavior aligned with `docs/runtime-configuration.md`.

## Proposed Execution Order

### Phase 1. Interaction safety

Scope:

- guarantee callback acknowledgement even when the handler throws
- preserve current centralized error handling behavior

Implementation direction:

- change the callback wrapper in `src/telegram/runtime-boundary-support.ts` so `answerCallbackQuery()` runs in a `finally` block
- if needed, ignore only the specific double-ack case instead of swallowing all callback acknowledgement errors

Acceptance criteria:

- callback handlers still route through the existing middleware and error path
- a thrown callback handler no longer leaves the client spinner hanging
- successful callbacks still behave exactly as before

### Phase 2. Session cleanup off the hot path

Scope:

- stop performing global expired-session cleanup during every update
- keep per-user session loading behavior unchanged

Implementation direction:

- remove the unconditional `deleteExpiredSessions()` call from `loadConversationSessionRuntime()`
- replace the current scan-based cleanup strategy with one of these minimal options:
  - preferred: delete expired session rows with a targeted storage-level operation
  - acceptable: run cleanup on a bounded cadence instead of per update
- keep direct deletion of the current session when it is already expired

Recommendation:

- prefer a storage-level targeted delete because it matches the database-integrity spec style: enforce and clean up at the persistence boundary, not inside every caller

Acceptance criteria:

- loading one session no longer scans all sessions
- expired current-session records are still ignored correctly
- session behavior for start, advance, and cancel stays unchanged

### Phase 3. Profile sync write reduction

Scope:

- keep the canonical `displayName` and `username` up to date
- avoid database writes when nothing changed

Implementation direction:

- update `syncUserProfile()` in `src/membership/access-flow-store.ts` to compare normalized incoming values against stored values before issuing `update(users)`
- return early when no effective change exists
- keep the existing fallback rule for `displayName` formatting intact

Acceptance criteria:

- known users with unchanged Telegram profile data do not trigger a database update
- changed `username` or `displayName` still persist correctly
- actor loading and authorization behavior remain unchanged

### Phase 4. Runtime service reuse

Scope:

- move stateless service construction out of per-update middleware when practical

Implementation direction:

- construct the board-game import service once during Telegram boundary creation or middleware pipeline assembly
- inject the ready-to-use service into runtime context instead of rebuilding it per update

Acceptance criteria:

- runtime context still exposes the same service API to Telegram flows
- per-update middleware no longer creates new import service instances

### Phase 5. Logging and operational visibility

Scope:

- improve diagnostics without changing bot behavior

Implementation direction:

- enrich update logs with structured metadata such as update kind, chat kind, chat id, user id, command name or callback prefix when available
- include enough context in error logs to identify the failing interaction path
- keep sensitive data out of logs

Acceptance criteria:

- operators can distinguish command, callback, and text failures from logs alone
- logs remain structured and low-noise
- secrets, passwords, and raw callback payloads are not logged indiscriminately

## Recommended First Correction Slice

Start with Phases 1 through 3 before touching observability polish.

Why:

- they address the clearest user-facing and scalability risks
- they are small, localized changes
- they do not require changing Telegram product behavior or admin flows

## Suggested Work Batches

### Batch A

- Phase 1: callback acknowledgement hardening

### Batch B

- Phase 2: session cleanup hardening

### Batch C

- Phase 3: profile sync write reduction

### Batch D

- Phase 4 and Phase 5 together if the earlier slices remain small

## Validation Strategy After Each Batch

- run targeted unit tests for the touched Telegram/runtime modules
- run `npm run lint`
- run `npm run typecheck`
- run `npm run build`
- after code changes are complete for the batch, run `./startup.sh` without `--dry-run`

If a batch changes database persistence semantics, add or update focused tests near the affected store before broad verification.

## Non-Goals

- switching from polling to webhooks
- redesigning Telegram flows or menus
- adding new health endpoints
- changing runtime secret storage rules
- introducing Redis or a new session backend in this hardening slice

## Implementation Notes

- Keep the existing fatal runtime design from `2026-04-12-telegram-runtime-resilience-design.md` intact.
- Reuse the database-boundary philosophy from `2026-04-12-database-integrity-concurrency-design.md`: do not solve persistence cost with repeated application-layer scans if the storage layer can do it directly.
- Maintain the current runtime contract and secret-loading behavior documented in `docs/runtime-configuration.md`.

## Exit Criteria

This hardening plan is complete when:

- callback UX is resilient under handler failures
- Telegram update handling no longer performs global session cleanup on every update
- unchanged user profiles no longer trigger redundant writes
- runtime service construction is no longer repeated unnecessarily in the hot path
- logs are sufficient to diagnose failing Telegram interactions in production
