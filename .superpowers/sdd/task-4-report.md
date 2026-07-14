# Task 4 report — Participant detail actions, confirmations, and notifications

## RED evidence

- Added participant-detail flow tests before production changes.
- `node --import tsx --test src/telegram/role-game-flow.test.ts` initially reported 8 expected failures: missing action buttons/routing, confirmations, stale/full recovery, mutations, and notification handling. The pre-existing 53 tests remained green.

## GREEN evidence

- Added `listRoleGameMemberActions` with the approved primary-GM/admin/coorganizer split and primary-GM/history protection.
- Participant details now show only allowed actions and require a separate confirmation state.
- Confirmed actions reload game, actor membership, and selected participant; they delegate to `manageRoleGameMember`, recover localized stale/full/permission/not-found outcomes, and return to the refreshed active list.
- Private notifications happen after persistence and are best-effort. Failures are structured-log warnings and do not roll back the domain change.
- The runtime command context now exposes the structured logger to this flow.

## Validation

- `node --import tsx --test src/role-games/role-game-catalog.test.ts src/telegram/role-game-participants.test.ts src/telegram/role-game-flow.test.ts` — 92 passed, 0 failed.
- `npm run typecheck` — passed.
- `./scripts/feature-status-audit.sh` — completed after updating the Rol inventory.
- `git diff --check` — passed.
- `./startup.sh` — built and restarted the service; follow-up checks: `systemctl is-active gameclubtelegrambot.service` returned `active`, `GET http://127.0.0.1:8787/` returned `200`, and the service journal recorded completed Telegram/database/Admin HTTP startup.

## Files

- `src/telegram/role-game-participants.ts`
- `src/telegram/role-game-flow.ts`
- `src/telegram/role-game-keyboards.ts`
- `src/telegram/i18n-role-games.ts`
- `src/telegram/role-game-flow.test.ts`
- `src/telegram/command-registry.ts`
- `src/telegram/runtime-boundary-support.ts`
- `docs/feature-status.md`

## Commit

- `feat: manage role game participants`

## Self-review

- Confirmed every approved transition is represented, with coorganizers restricted to requested-member confirm/reject only.
- Confirmed no session-cached participant role/status is trusted when an action is executed.
- Confirmed primary GM and history remain action-free, errors refresh the participant list, and notification failure is isolated from persistence.

## Concerns

- `startup.sh` emitted two non-fatal `rsync --delete` messages for an existing `/opt/gameclubtelegrambot/.config/opencode` directory. The deploy still restarted successfully and the fresh service/HTTP checks above passed. This environment deployment artifact is outside Task 4 scope.

---

## Task 4 review fixes — RED/GREEN evidence

### RED

- Added the review regressions before changing production code, then ran:

  ```bash
  node --import tsx --test src/telegram/role-game-flow.test.ts
  ```

  Result: 65 passed, 2 failed (of 67).

  - The notification test expected the required warning message
    `role-game.participant-notification.failed`, but the old implementation
    emitted `Role game participant notification failed` and did not assert the
    required structured bindings.
  - After `manageRoleGameMember` persisted a confirmation, a deliberately
    failing participant-list reconstruction left the session in
    `confirm-action`, retaining the stale pending action.

- Added flow coverage for coorganizer confirmation of a requested participant,
  primary-GM confirmation of invited and waitlisted participants, primary-GM
  removal of a confirmed coorganizer, and admin cancellation of an invitation.
  These transition tests passed against the existing domain permissions and
  protect the intended management matrix.

### GREEN

- Immediately after a successful `manageRoleGameMember` call, the flow replaces
  the confirmation session with a participants session before notification or
  refreshed-list reconstruction. A later rendering failure therefore cannot
  retain a confirmable stale action.
- Notification failures now always emit the warning message
  `role-game.participant-notification.failed` at warning level with
  `gameId`, `memberId`, `recipientTelegramUserId`, `action`, and `error`.
  The runtime logger is used when present; otherwise a structured JSON
  `console.warn` adapter preserves the warning-level guarantee. Notification
  failure remains best-effort and never rolls back persistence.
- Centralized the typed role-game member action list and action-to-label helper
  in `i18n-role-games.ts`. Both participant keyboards and text action routing
  now consume that helper; neither contains a duplicate label mapping.

### Review validation

- Focused RED/GREEN run:

  ```bash
  node --import tsx --test src/telegram/role-game-flow.test.ts && npm run typecheck
  ```

  Result: 67 passed, 0 failed; typecheck passed.

- Required task run:

  ```bash
  node --import tsx --test src/role-games/role-game-catalog.test.ts src/telegram/role-game-participants.test.ts src/telegram/role-game-flow.test.ts
  npm run typecheck
  git diff --check
  ```

  Result: 98 passed, 0 failed; typecheck passed; diff check passed. The run
  includes the existing external one-shot/deep-link participant tests.

- `./startup.sh` built the application (version `0.4.20260713210751`) but its
  deployment phase again stopped at the existing
  `cannot delete non-empty directory: .config/opencode` rsync artifact before
  printing its normal completion sequence. The existing service remained
  `active`, and `GET http://127.0.0.1:8787/` returned `200`.

### Review self-review

- Verified the pending-action replacement is ordered strictly after persistence
  and before every best-effort or list-rendering step that can throw.
- Verified the failure-warning path cannot silently omit logging or downgrade
  to error, and its full structured bindings are asserted by a flow test.
- Verified the new transition coverage preserves the primary-GM/admin/coorganizer
  split and that no session-cached target state authorizes a mutation.
- Verified action labels are defined once in the typed i18n helper and consumed
  by both keyboard rendering and text routing.

### Review concerns

- The repeated `startup.sh` rsync artifact prevented proving a fresh restart in
  this review invocation. Current service activity and internal health were
  verified, but deployment-script remediation is outside this task's scope.
