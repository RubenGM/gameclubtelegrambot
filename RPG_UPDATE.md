# RPG_UPDATE.md

## Purpose

This document contains the handoff needed to start a Codex goal that implements
the `Rol` / role-games feature for the Telegram bot.

Use it when starting implementation work from the current plan. Do not treat it
as a replacement for the spec or implementation plan; treat it as the launch
brief that tells the next worker exactly where to begin and what must not be
missed.

## Current State

- Repository: `/home/cawa/telegrambot/gameclubtelegrambot`
- Branch prepared for implementation: `codex/role-games`
- Remote branch: `origin/codex/role-games`
- Base design commit on `main`: `68b9062 Documenta diseño de partidas de rol`
- Implementation-plan commit on `codex/role-games`: `a74a4bf docs: plan role games implementation`
- Working tree should be clean before starting implementation.

Confirm before starting:

```bash
cd /home/cawa/telegrambot/gameclubtelegrambot
git status --short --branch
git branch --show-current
```

Expected:

```text
## codex/role-games...origin/codex/role-games
codex/role-games
```

If not on `codex/role-games`, switch to it:

```bash
git switch codex/role-games
git pull --ff-only
```

## Goal To Start

Recommended goal objective:

```text
Implement the Telegram Rol feature from docs/superpowers/plans/2026-07-09-role-games.md task by task, preserving the approved design in docs/superpowers/specs/2026-07-09-role-games-design.md. Build the first version for organizing RPG campaigns and one-shots with Agenda-backed sessions, hidden Storage-backed handouts, Telegram UX guardrails, full tests, docs updates, and deployment validation.
```

If using Codex goal tooling, create the goal with that objective. Do not add a
token budget unless explicitly requested by the user.

## Required Reading Before Implementation

Read these first, in this order:

1. `docs/superpowers/specs/2026-07-09-role-games-design.md`
2. `docs/superpowers/plans/2026-07-09-role-games.md`
3. `docs/telegram-pagination-style.md`
4. `docs/telegram-editable-progress.md`
5. `docs/feature-status.md`
6. `docs/llm-natural-language.md` before touching LLM Storage search behavior.

Also respect the repo instructions in `AGENTS.md` from the conversation:

- Spanish/Catalan docs may use normal Unicode.
- After code changes, run `./startup.sh` before handing work back unless the user
  explicitly says not to.
- If `docs/feature-status.md` changes, run
  `./scripts/feature-status-audit.sh`.
- For LLM/Codex/OpenCode integration, use the documented wrappers and do not
  hardcode binaries.

## Required Implementation Skill

The plan header requires one of these execution modes:

- Recommended: `superpowers:subagent-driven-development`
- Alternative: `superpowers:executing-plans`

Do not start coding by improvising. Execute
`docs/superpowers/plans/2026-07-09-role-games.md` task by task with review
checkpoints.

## Non-Negotiable Product Requirements

The first version must implement `Rol` as a first-class private Telegram feature
for approved members.

The feature must support:

- Campaigns and one-shots.
- One-shot initial session creation with day/time.
- Campaign manual assisted scheduling.
- Campaign recurring scheduling with a configurable future-session window.
- Confirmed players, character name, and a short note.
- Main GM plus coorganizers.
- Configurable entry mode: invitation or request.
- Configurable acceptance: manual review or auto-accept until full.
- Configurable visibility: private, members, public.
- Public one-shots that may accept external Telegram users without approving
  them as club members.
- Agenda-backed sessions, not a parallel role-game calendar.
- Optional auto-add of confirmed players to generated Agenda sessions.
- Hidden handouts stored via Storage infrastructure.
- Handout actions:
  - send only this time
  - send and reveal
  - reveal without sending

## Non-Negotiable Telegram UX Rules

Every guided Telegram flow must include `Cancelar`.

`Cancelar` must:

- clear the active session;
- return the bot to a normal/root or normal/context state;
- avoid leaving orphan keyboards such as a lone cancel button.

Important actions must use semantic button roles so the existing UI can
highlight them. Examples:

- Crear partida
- Confirmar
- Guardar
- Programar siguiente sesión
- Solicitar plaza
- Aceptar solicitud
- Enviar y revelar
- Enviar sólo esta vez

Long lists must use the existing pagination style:

```text
Mostrando X-Y de Z. Página A/B.
```

Use inline/deep links for opening details whenever the message body can carry
navigation cleanly.

## Critical Handout Privacy Rule

This is the easiest feature to get dangerously wrong:

Handouts must never be discoverable through normal Storage surfaces, even though
they use Storage infrastructure internally.

They must not appear in:

- `/storage`
- Storage category browsing
- Storage tag browsing
- Storage search
- normal web Storage
- normal TUI Storage
- LLM `storage.search`
- transverse LLM `bot.search` Storage results

User-facing deep links for handouts must be `role_material_<id>` and must route
through `Rol` permission checks. Do not expose `storage_entry_<id>` for handouts.

Authorization for handouts:

- `gm_only`: main GM, coorganizers, admins.
- `players`: confirmed players, main GM, coorganizers, admins.
- external users: only confirmed players of their specific public game, and only
  for `players` material.

## Implementation Plan Summary

The detailed plan is in:

```text
docs/superpowers/plans/2026-07-09-role-games.md
```

Follow the tasks in order:

1. Schema and domain model.
2. Database repository.
3. Telegram menu, i18n, and read-only lists.
4. Create games and manage requests.
5. Agenda-backed one-shots and manual sessions.
6. Recurring campaign window.
7. Hidden Storage infrastructure for handouts.
8. Handout upload, visibility, and delivery.
9. Public one-shot external access.
10. Documentation, feature status, and final validation.

Each task has its own files, interfaces, failing tests, implementation steps,
verification commands, and commit command. Keep commits task-sized.

## Expected Files To Create

Domain and storage:

- `src/role-games/role-game-catalog.ts`
- `src/role-games/role-game-catalog-store.ts`
- `src/role-games/role-game-catalog.test.ts`
- `src/role-games/role-game-catalog-store.test.ts`
- `src/role-games/role-game-scheduler.ts`
- `src/role-games/role-game-scheduler.test.ts`
- `src/storage/storage-internal-purpose.ts`
- `src/storage/storage-internal-purpose.test.ts`

Telegram:

- `src/telegram/i18n-role-games.ts`
- `src/telegram/role-game-keyboards.ts`
- `src/telegram/role-game-presentation.ts`
- `src/telegram/role-game-flow.ts`
- `src/telegram/role-game-flow.test.ts`

Likely files to modify:

- `src/infrastructure/database/schema.ts`
- `src/storage/storage-catalog.ts`
- `src/storage/storage-catalog-store.ts`
- `src/storage/storage-catalog-store.test.ts`
- `src/telegram/i18n.ts`
- `src/telegram/i18n-common.ts`
- `src/telegram/action-menu.ts`
- `src/telegram/action-menu.test.ts`
- `src/telegram/runtime-boundary-registration.ts`
- `src/telegram/runtime-boundary.test.ts`
- `src/telegram/llm-command-read-actions.ts`
- `src/bootstrap/create-app.ts`
- `src/bootstrap/create-app.test.ts`
- `docs/feature-status.md`
- `docs/llm-natural-language.md` if LLM Storage filtering behavior changes.

## Core Data Model Names

Use these names consistently:

- Tables: `role_games`, `role_game_members`, `role_game_sessions`,
  `role_game_materials`, `role_game_material_deliveries`.
- Domain types: `RoleGameRecord`, `RoleGameMemberRecord`,
  `RoleGameSessionRecord`, `RoleGameMaterialRecord`.
- Repository factory: `createDatabaseRoleGameRepository`.
- Telegram flow: `handleTelegramRoleGameText`,
  `handleTelegramRoleGameStartText`, `handleTelegramRoleGameCallback`.
- Deep links: `role_game_<id>`, `role_session_<id>`, `role_material_<id>`.
- Root action id: `role_games`.
- Visible root menu label: `Rol`.

## Testing Commands

Run targeted tests as tasks land:

```bash
node --import tsx --test src/role-games/role-game-catalog.test.ts
node --import tsx --test src/role-games/role-game-catalog-store.test.ts
node --import tsx --test src/role-games/role-game-scheduler.test.ts
node --import tsx --test src/telegram/role-game-flow.test.ts
node --import tsx --test src/telegram/action-menu.test.ts
node --import tsx --test src/telegram/runtime-boundary.test.ts
node --import tsx --test src/storage/storage-catalog-store.test.ts
node --import tsx --test src/telegram/storage-flow.test.ts
```

Final validation must include:

```bash
npm run typecheck
npm run db:check
./scripts/feature-status-audit.sh
./startup.sh
```

After startup, verify service and local HTTP health:

```bash
systemctl is-active gameclubtelegrambot.service
curl -fsS http://127.0.0.1:8787/ >/tmp/gameclub-role-games-health.html
```

Expected:

- service is `active`;
- curl exits 0;
- no dirty worktree except intentional committed changes.

## Documentation Requirements

Update `docs/feature-status.md` in the implementation branch when behavior
lands.

The feature-status update must cover:

- root private menu button `Rol`;
- campaigns and one-shots;
- Agenda-backed sessions;
- recurring campaign windows;
- manual assisted scheduling;
- player management;
- hidden handouts;
- public one-shot access for external Telegram users.

Run:

```bash
./scripts/feature-status-audit.sh
```

If LLM Storage search filtering is changed, update
`docs/llm-natural-language.md` to state that hidden role-game handouts are
excluded from LLM Storage searches and transverse bot searches.

## Commit And Push Expectations

Use task-sized commits. The implementation plan gives suggested commit messages.

Before each commit:

```bash
git status --short
git diff --check
```

After final validation:

```bash
git status --short --branch
git push
```

If the branch is not already tracking remote:

```bash
git push -u origin codex/role-games
```

## Completion Criteria

The goal is complete only when all are true:

- All tasks in `docs/superpowers/plans/2026-07-09-role-games.md` are implemented
  or explicitly superseded by an approved change.
- `Rol` appears in the private root menu for approved users.
- Campaigns and one-shots can be created from Telegram.
- One-shot sessions and campaign sessions are real Agenda events.
- Recurring campaigns maintain their configured future-session window.
- Player requests, confirmation, coorganizer permissions, and external public
  one-shot access behave as specified.
- Handouts are stored internally but invisible from all normal Storage and LLM
  Storage surfaces.
- Handout send/reveal actions work and record delivery outcomes.
- `docs/feature-status.md` is updated.
- Required targeted tests pass.
- `npm run typecheck` passes.
- `npm run db:check` passes if migrations changed.
- `./scripts/feature-status-audit.sh` passes or reports only reviewed guidance.
- `./startup.sh` completes and the service is active.
- The branch is pushed.

## Suggested First Message For The Goal

Use this as the first instruction when launching the implementation goal:

```text
Implement the `Rol` role-games feature by executing docs/superpowers/plans/2026-07-09-role-games.md task by task on branch codex/role-games. Read RPG_UPDATE.md, the design spec, and the implementation plan first. Preserve all Telegram UX rules, especially Cancel behavior, highlighted important actions, pagination, inline detail links, and hidden handouts that never appear through Storage or LLM Storage search. Use TDD per task, commit task-sized changes, update docs/feature-status.md, run targeted tests plus typecheck/db check/feature audit/startup, and push the branch when complete.
```
