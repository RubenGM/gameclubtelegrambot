# Role Games Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first version of the Telegram `Rol` feature for organizing RPG campaigns and one-shots with Agenda-backed sessions and Storage-backed hidden handouts.

**Architecture:** Add a new `role-games` domain with focused repositories, then expose it through a Telegram flow at `src/telegram/role-game-flow.ts`. Agenda remains the source of truth for dated sessions; Storage stores files only as hidden infrastructure, while `Rol` owns visibility and handout access.

**Tech Stack:** TypeScript, Node test runner with `node --import tsx --test`, Drizzle/Postgres schema in `src/infrastructure/database/schema.ts`, Telegram reply/inline keyboards, existing Agenda and Storage domain services.

## Global Constraints

- Read `docs/telegram-pagination-style.md` before implementing paginated `Rol` lists.
- Read `docs/telegram-editable-progress.md` before implementing handout upload/delivery progress messages.
- Every guided Telegram flow must expose `Cancelar` and cancellation must clear the session and return to normal bot state.
- Important keyboard actions must use semantic button roles so they are visually highlighted by the existing Telegram UI system.
- Long lists must be paginated with the existing footer style, including Spanish `Mostrando X-Y de Z. Página A/B`.
- Prefer inline/deep links for opening details when the body text can carry the navigation.
- Handouts must not appear in `/storage`, Storage search, Storage category/tag listings, normal web Storage, normal TUI Storage, or LLM Storage search.
- User-facing Spanish/Catalan prose may use normal Unicode accents and punctuation.
- Any code change must finish with targeted tests, `npm run typecheck`, `./scripts/feature-status-audit.sh`, and `./startup.sh`; add `npm run db:check` when schema/migrations change.

---

## File Structure

Create:

- `src/role-games/role-game-catalog.ts` - domain types, validation, permission helpers, and use-case functions for games, members, sessions, and materials.
- `src/role-games/role-game-catalog-store.ts` - Drizzle repository implementation for the new tables.
- `src/role-games/role-game-catalog.test.ts` - domain tests with in-memory repositories.
- `src/role-games/role-game-catalog-store.test.ts` - repository tests for mapping and constraints.
- `src/role-games/role-game-scheduler.ts` - session creation helpers that bridge role games to Agenda.
- `src/role-games/role-game-scheduler.test.ts` - unit tests for manual sessions, recurrence windows, and auto-attendance.
- `src/telegram/i18n-role-games.ts` - localized copy for `Rol`.
- `src/telegram/role-game-keyboards.ts` - reply/inline keyboard builders, callback prefixes, pagination helpers.
- `src/telegram/role-game-presentation.ts` - detail/list formatting, deep links, and safe labels.
- `src/telegram/role-game-flow.ts` - Telegram text/start/callback handlers for `Rol`.
- `src/telegram/role-game-flow.test.ts` - Telegram flow tests.
- `src/storage/storage-internal-purpose.ts` - constants/helpers for internal hidden Storage purposes.
- `src/storage/storage-internal-purpose.test.ts` - tests that hidden purposes are filtered.

Modify:

- `src/infrastructure/database/schema.ts` - add role-game tables and extend Storage purpose/status for hidden role-game handouts.
- `src/storage/storage-catalog.ts` - add internal purpose/status types and filtering contract.
- `src/storage/storage-catalog-store.ts` - filter hidden role-game handouts from normal list/search paths.
- `src/storage/storage-catalog-store.test.ts` - cover hidden handouts in Storage queries.
- `src/telegram/i18n.ts` - export `roleGames` text group.
- `src/telegram/i18n-common.ts` - add `actionMenu.roleGames` and help text.
- `src/telegram/action-menu.ts` - add root menu action `role_games`.
- `src/telegram/action-menu.test.ts` - update root menu expectations.
- `src/telegram/runtime-boundary-registration.ts` - route `/role_games`, `/rol`, menu action, callbacks, and start payloads.
- `src/telegram/runtime-boundary.test.ts` - add routing/menu regression tests.
- `src/telegram/llm-command-read-actions.ts` - exclude internal role-game handouts from LLM Storage reads.
- `docs/feature-status.md` - document `Rol` in the feature inventory and summary table.
- `docs/llm-natural-language.md` - only update if implementation touches LLM search filtering directly; otherwise add no new LLM intent.

---

### Task 1: Schema And Domain Model

**Files:**
- Modify: `src/infrastructure/database/schema.ts`
- Create: `src/role-games/role-game-catalog.ts`
- Create: `src/role-games/role-game-catalog.test.ts`

**Interfaces:**
- Produces:
  - `RoleGameRecord`
  - `RoleGameMemberRecord`
  - `RoleGameMaterialRecord`
  - `RoleGameSessionRecord`
  - `RoleGameRepository`
  - `createRoleGame(input)`
  - `requestRoleGameSeat(input)`
  - `setRoleGameMemberStatus(input)`
  - `canViewRoleGame(actor, game, membership)`
  - `canManageRoleGame(actor, game, membership)`
  - `canManageRoleGameOperationally(actor, game, membership)`

- [ ] **Step 1: Add failing domain tests for game validation and permissions**

Create `src/role-games/role-game-catalog.test.ts` with tests shaped like:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canManageRoleGame,
  canManageRoleGameOperationally,
  canViewRoleGame,
  createRoleGame,
  requestRoleGameSeat,
  type RoleGameRepository,
} from './role-game-catalog.js';

test('createRoleGame normalizes a member-visible campaign with primary GM', async () => {
  const repository = createMemoryRoleGameRepository();
  const game = await createRoleGame({
    repository,
    type: 'campaign',
    title: 'La Maldición de Strahd',
    system: 'D&D 5e',
    description: 'Campaña gótica de larga duración',
    visibility: 'members',
    publicJoinPolicy: 'members_only',
    entryMode: 'request',
    acceptanceMode: 'manual_review',
    capacity: 5,
    primaryGmTelegramUserId: 42,
    createdByTelegramUserId: 42,
    defaultDurationMinutes: 180,
    defaultTableId: null,
    defaultAttendanceMode: 'closed',
    defaultIsPublicScheduleEvent: false,
    autoAddConfirmedPlayers: true,
    allowPlayerManualScheduling: true,
    schedulingMode: 'manual',
    recurrenceRule: null,
    recurrenceWindowCount: 0,
  });

  assert.equal(game.title, 'La Maldición de Strahd');
  assert.equal(game.primaryGmTelegramUserId, 42);
  assert.equal(game.status, 'active');
});

test('canManageRoleGame allows primary GM and admin only for full management', () => {
  const game = sampleGame({ primaryGmTelegramUserId: 42 });

  assert.equal(canManageRoleGame({ telegramUserId: 42, isAdmin: false }, game, null), true);
  assert.equal(canManageRoleGame({ telegramUserId: 99, isAdmin: true }, game, null), true);
  assert.equal(
    canManageRoleGame(
      { telegramUserId: 77, isAdmin: false },
      game,
      sampleMember({ telegramUserId: 77, role: 'coorganizer', status: 'confirmed' }),
    ),
    false,
  );
});

test('canManageRoleGameOperationally allows coorganizers', () => {
  const game = sampleGame({ primaryGmTelegramUserId: 42 });
  const coorganizer = sampleMember({ telegramUserId: 77, role: 'coorganizer', status: 'confirmed' });

  assert.equal(canManageRoleGameOperationally({ telegramUserId: 77, isAdmin: false }, game, coorganizer), true);
});

test('requestRoleGameSeat auto-confirms while capacity remains', async () => {
  const repository = createMemoryRoleGameRepository();
  const game = await repository.createGame(sampleCreateInput({
    capacity: 2,
    entryMode: 'request',
    acceptanceMode: 'auto_until_full',
  }));

  const member = await requestRoleGameSeat({
    repository,
    gameId: game.id,
    telegramUserId: 100,
    actorTelegramUserId: 100,
    isExternal: false,
  });

  assert.equal(member.status, 'confirmed');
});
```

Include small `sampleGame`, `sampleMember`, and `createMemoryRoleGameRepository` helpers in the test file. The memory repository should implement only the methods used by these tests.

- [ ] **Step 2: Run the failing tests**

Run:

```bash
node --import tsx --test src/role-games/role-game-catalog.test.ts
```

Expected: FAIL because `src/role-games/role-game-catalog.ts` does not exist.

- [ ] **Step 3: Add schema tables and domain types**

Modify `src/infrastructure/database/schema.ts` after `scheduleEventReminders` or near adjacent event-like tables. Add:

```ts
export const roleGames = pgTable(
  'role_games',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    type: varchar('type', { length: 16 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    title: varchar('title', { length: 255 }).notNull(),
    system: varchar('system', { length: 120 }).notNull(),
    description: text('description'),
    visibility: varchar('visibility', { length: 16 }).notNull().default('members'),
    publicJoinPolicy: varchar('public_join_policy', { length: 32 }).notNull().default('members_only'),
    entryMode: varchar('entry_mode', { length: 16 }).notNull().default('request'),
    acceptanceMode: varchar('acceptance_mode', { length: 24 }).notNull().default('manual_review'),
    capacity: integer('capacity').notNull(),
    primaryGmTelegramUserId: bigint('primary_gm_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    defaultDurationMinutes: integer('default_duration_minutes').notNull().default(180),
    defaultTableId: bigint('default_table_id', { mode: 'number' }).references(() => clubTables.id),
    defaultAttendanceMode: varchar('default_attendance_mode', { length: 16 }).notNull().default('closed'),
    defaultIsPublicScheduleEvent: boolean('default_is_public_schedule_event').notNull().default(false),
    autoAddConfirmedPlayers: boolean('auto_add_confirmed_players').notNull().default(false),
    allowPlayerManualScheduling: boolean('allow_player_manual_scheduling').notNull().default(false),
    schedulingMode: varchar('scheduling_mode', { length: 16 }).notNull().default('manual'),
    recurrenceRule: jsonb('recurrence_rule'),
    recurrenceWindowCount: integer('recurrence_window_count').notNull().default(0),
    createdByTelegramUserId: bigint('created_by_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (table) => ({
    statusLookup: index('role_games_status_idx').on(table.status),
    visibilityLookup: index('role_games_visibility_idx').on(table.visibility),
    primaryGmLookup: index('role_games_primary_gm_idx').on(table.primaryGmTelegramUserId),
  }),
);
```

Add `roleGameMembers`, `roleGameSessions`, `roleGameMaterials`, and `roleGameMaterialDeliveries` in the same file using the field names from the design spec. Use indexes on `roleGameId`, `telegramUserId`, `scheduleEventId`, and `internalStorageEntryId`.

Create `src/role-games/role-game-catalog.ts` with exported union types and repository interface:

```ts
export type RoleGameType = 'campaign' | 'one_shot';
export type RoleGameStatus = 'active' | 'paused' | 'closed' | 'cancelled';
export type RoleGameVisibility = 'private' | 'members' | 'public';
export type RoleGamePublicJoinPolicy = 'members_only' | 'members_and_external';
export type RoleGameEntryMode = 'invite_only' | 'request';
export type RoleGameAcceptanceMode = 'manual_review' | 'auto_until_full';
export type RoleGameSchedulingMode = 'manual' | 'recurring';
export type RoleGameMemberRole = 'primary_gm' | 'coorganizer' | 'player';
export type RoleGameMemberStatus = 'invited' | 'requested' | 'confirmed' | 'waitlisted' | 'left' | 'removed' | 'rejected';
export type RoleGameMaterialVisibility = 'players' | 'gm_only';
export type RoleGameMaterialDeliveryState = 'not_sent' | 'sent' | 'revealed';

export interface RoleGameActor {
  telegramUserId: number;
  isAdmin: boolean;
  isApproved?: boolean;
}

export interface RoleGameRecord {
  id: number;
  type: RoleGameType;
  status: RoleGameStatus;
  title: string;
  system: string;
  description: string | null;
  visibility: RoleGameVisibility;
  publicJoinPolicy: RoleGamePublicJoinPolicy;
  entryMode: RoleGameEntryMode;
  acceptanceMode: RoleGameAcceptanceMode;
  capacity: number;
  primaryGmTelegramUserId: number;
  defaultDurationMinutes: number;
  defaultTableId: number | null;
  defaultAttendanceMode: 'open' | 'closed';
  defaultIsPublicScheduleEvent: boolean;
  autoAddConfirmedPlayers: boolean;
  allowPlayerManualScheduling: boolean;
  schedulingMode: RoleGameSchedulingMode;
  recurrenceRule: RoleGameRecurrenceRule | null;
  recurrenceWindowCount: number;
  createdByTelegramUserId: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface RoleGameRecurrenceRule {
  intervalWeeks: number;
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  time: string;
}
```

Define `CreateRoleGameInput`, `RoleGameMemberRecord`, `RoleGameRepository`, validation helpers, and functions required by the tests.

- [ ] **Step 4: Run tests until domain passes**

Run:

```bash
node --import tsx --test src/role-games/role-game-catalog.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/database/schema.ts src/role-games/role-game-catalog.ts src/role-games/role-game-catalog.test.ts
git commit -m "feat: add role game domain model"
```

---

### Task 2: Database Repository

**Files:**
- Create: `src/role-games/role-game-catalog-store.ts`
- Create: `src/role-games/role-game-catalog-store.test.ts`
- Modify: migration files generated by the repo's Drizzle workflow

**Interfaces:**
- Consumes: `RoleGameRepository` from Task 1.
- Produces: `createDatabaseRoleGameRepository({ database })`.

- [ ] **Step 1: Write repository tests**

Create `src/role-games/role-game-catalog-store.test.ts` with cases:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabaseRoleGameRepository } from './role-game-catalog-store.js';

test('database role game repository creates and reads a campaign', async () => {
  const { database, seedUser, cleanup } = await createRoleGameStoreFixture();
  t.after(cleanup);
  await seedUser(42, 'Máster');

  const repository = createDatabaseRoleGameRepository({ database });
  const created = await repository.createGame({
    type: 'campaign',
    status: 'active',
    title: 'Masks of Nyarlathotep',
    system: 'Call of Cthulhu',
    description: 'Campaña de investigación',
    visibility: 'members',
    publicJoinPolicy: 'members_only',
    entryMode: 'request',
    acceptanceMode: 'manual_review',
    capacity: 5,
    primaryGmTelegramUserId: 42,
    defaultDurationMinutes: 180,
    defaultTableId: null,
    defaultAttendanceMode: 'closed',
    defaultIsPublicScheduleEvent: false,
    autoAddConfirmedPlayers: true,
    allowPlayerManualScheduling: true,
    schedulingMode: 'manual',
    recurrenceRule: null,
    recurrenceWindowCount: 0,
    createdByTelegramUserId: 42,
  });

  const loaded = await repository.findGameById(created.id);
  assert.equal(loaded?.title, 'Masks of Nyarlathotep');
});
```

Follow existing store test fixture patterns in `src/lfg/lfg-catalog-store.test.ts` and `src/schedule/schedule-catalog-store.test.ts`. Seed required `users` rows before inserting role-game rows.

- [ ] **Step 2: Run failing repository tests**

```bash
node --import tsx --test src/role-games/role-game-catalog-store.test.ts
```

Expected: FAIL because repository does not exist or tables are not migrated.

- [ ] **Step 3: Implement `createDatabaseRoleGameRepository`**

Implement methods:

```ts
export function createDatabaseRoleGameRepository({ database }: { database: DbLike }): RoleGameRepository {
  return {
    async createGame(input) { /* insert roleGames and primary roleGameMembers row in a transaction */ },
    async findGameById(gameId) { /* select one */ },
    async updateGame(input) { /* update metadata */ },
    async listVisibleGames(input) { /* filter by visibility and membership */ },
    async listGamesForUser(telegramUserId) { /* join members */ },
    async createOrUpdateMember(input) { /* upsert roleGameMembers */ },
    async findMember(gameId, telegramUserId) { /* select one */ },
    async listMembers(gameId) { /* select by game */ },
    async createSessionLink(input) { /* insert roleGameSessions */ },
    async listSessionLinks(gameId) { /* select by game */ },
    async createMaterial(input) { /* insert roleGameMaterials */ },
    async findMaterialById(materialId) { /* select one */ },
    async updateMaterialVisibility(input) { /* reveal */ },
    async createMaterialDelivery(input) { /* insert roleGameMaterialDeliveries */ },
  };
}
```

Keep mapping functions local and explicit, matching `RoleGameRecord` property names.

- [ ] **Step 4: Generate/apply migration**

Use the repo's Drizzle migration workflow. Run:

```bash
npm run db:check
```

Expected before migration: FAIL if migration metadata is missing. Generate the migration with:

```bash
npm run db:generate
```

Then rerun:

```bash
npm run db:check
```

- [ ] **Step 5: Run repository tests**

```bash
node --import tsx --test src/role-games/role-game-catalog-store.test.ts
npm run db:check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/role-games/role-game-catalog-store.ts src/role-games/role-game-catalog-store.test.ts src/infrastructure/database/schema.ts drizzle package.json package-lock.json
git commit -m "feat: persist role games"
```

The generated migration files live under `drizzle`; stage the new files created by `npm run db:generate`.

---

### Task 3: Telegram Menu, I18n, And Read-Only Lists

**Files:**
- Create: `src/telegram/i18n-role-games.ts`
- Create: `src/telegram/role-game-keyboards.ts`
- Create: `src/telegram/role-game-presentation.ts`
- Create: `src/telegram/role-game-flow.ts`
- Create: `src/telegram/role-game-flow.test.ts`
- Modify: `src/telegram/i18n.ts`
- Modify: `src/telegram/i18n-common.ts`
- Modify: `src/telegram/action-menu.ts`
- Modify: `src/telegram/action-menu.test.ts`
- Modify: `src/telegram/runtime-boundary-registration.ts`
- Modify: `src/telegram/runtime-boundary.test.ts`

**Interfaces:**
- Consumes: `RoleGameRepository`.
- Produces:
  - `roleGameCallbackPrefixes`
  - `handleTelegramRoleGameText(context)`
  - `handleTelegramRoleGameStartText(context)`
  - `handleTelegramRoleGameCallback(context)`

- [ ] **Step 1: Write failing menu/routing tests**

Add expectations to `src/telegram/action-menu.test.ts` that approved users see `Rol` in the root menu. Keep admin tools behind `Admin`.

Add `src/telegram/role-game-flow.test.ts`:

```ts
test('handleTelegramRoleGameText opens the role game home menu', async () => {
  const context = createRoleGameTestContext({ messageText: '/rol' });
  const handled = await handleTelegramRoleGameText(context);

  assert.equal(handled, true);
  assert.match(lastReply(context).message, /Rol/);
  assert.deepEqual(lastReply(context).options?.replyKeyboard?.at(0)?.map((button) => button.text), ['Mis partidas', 'Partidas visibles']);
});
```

Add runtime test that the root action `Rol` routes to the flow.

- [ ] **Step 2: Run failing tests**

```bash
node --import tsx --test src/telegram/action-menu.test.ts src/telegram/role-game-flow.test.ts src/telegram/runtime-boundary.test.ts
```

Expected: FAIL because `Rol` does not exist.

- [ ] **Step 3: Add i18n and menu action**

Add `roleGames` text group in `src/telegram/i18n-role-games.ts` with Catalan, Spanish, and English keys:

```ts
export const roleGameTexts = {
  ca: { menuTitle: 'Rol', myGames: 'Les meves partides', visibleGames: 'Partides visibles', createGame: 'Crear partida', cancel: 'Cancel·lar' },
  es: { menuTitle: 'Rol', myGames: 'Mis partidas', visibleGames: 'Partidas visibles', createGame: 'Crear partida', cancel: 'Cancelar' },
  en: { menuTitle: 'Role-playing', myGames: 'My games', visibleGames: 'Visible games', createGame: 'Create game', cancel: 'Cancel' },
} as const;
```

Export it through `src/telegram/i18n.ts`. Add `actionMenu.roleGames` to `src/telegram/i18n-common.ts`.

In `src/telegram/action-menu.ts`, add action:

```ts
{
  id: 'role_games',
  label: (language) => createTelegramI18n(language).actionMenu.roleGames,
  telemetryActionKey: 'menu.role_games',
  uxSection: 'primary',
  buttonRole: 'primary',
  contexts: ['private'],
  isVisible: (context) => context.actor.isApproved && !context.actor.isBlocked,
}
```

Place it near `lfg`/`notices` in root rows.

- [ ] **Step 4: Implement read-only flow shell**

`src/telegram/role-game-flow.ts` exports handlers. Start with home menu, paginated empty lists, and start payload parsing:

```ts
export const roleGameCallbackPrefixes = {
  detail: 'role_game:detail:',
  listMine: 'role_game:list:mine:',
  listVisible: 'role_game:list:visible:',
} as const;

export async function handleTelegramRoleGameText(context: TelegramCommandHandlerContext): Promise<boolean> {
  const language = context.runtime.language;
  const texts = createTelegramI18n(language).roleGames;
  if (!matchesRoleGameEntry(context.messageText, texts)) {
    return false;
  }
  await context.reply(texts.menuTitle, buildRoleGameHomeKeyboard(language));
  return true;
}
```

Use `buildTelegramStartUrl('role_game_<id>')` in presentation rows.

- [ ] **Step 5: Wire runtime registration**

In `src/telegram/runtime-boundary-registration.ts`:

- import role-game handlers
- call `handleTelegramRoleGameText` after LFG/notices-level private flows and before generic schedule fallback
- route action menu selection `role_games`
- route `/rol` and `/role_games`
- route `/start role_game_<id>`
- route callbacks with `roleGameCallbackPrefixes`

- [ ] **Step 6: Run tests**

```bash
node --import tsx --test src/telegram/action-menu.test.ts src/telegram/role-game-flow.test.ts src/telegram/runtime-boundary.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/telegram/i18n-role-games.ts src/telegram/role-game-keyboards.ts src/telegram/role-game-presentation.ts src/telegram/role-game-flow.ts src/telegram/role-game-flow.test.ts src/telegram/i18n.ts src/telegram/i18n-common.ts src/telegram/action-menu.ts src/telegram/action-menu.test.ts src/telegram/runtime-boundary-registration.ts src/telegram/runtime-boundary.test.ts
git commit -m "feat: add role games menu"
```

---

### Task 4: Create Games And Manage Requests

**Files:**
- Modify: `src/telegram/role-game-flow.ts`
- Modify: `src/telegram/role-game-keyboards.ts`
- Modify: `src/telegram/role-game-presentation.ts`
- Modify: `src/telegram/role-game-flow.test.ts`
- Modify: `src/role-games/role-game-catalog.ts`
- Modify: `src/role-games/role-game-catalog.test.ts`

**Interfaces:**
- Consumes: `createRoleGame`, `requestRoleGameSeat`, `setRoleGameMemberStatus`.
- Produces guided flow keys:
  - `role-game-create`
  - `role-game-request-review`

- [ ] **Step 1: Add failing creation flow tests**

In `role-game-flow.test.ts`, cover:

- `/rol` -> `Crear partida`
- type campaign
- title
- system
- description
- capacity
- visibility
- entry/acceptance modes
- scheduling mode
- final confirmation

Use exact assertions:

```ts
assert.equal(getCurrentSession()?.flowKey, 'role-game-create');
assert.equal(createdGame?.title, 'La campaña de prueba');
assert.equal(createdGame?.primaryGmTelegramUserId, context.runtime.actor.telegramUserId);
assert.match(lastReply(context).message, /Partida creada/);
```

- [ ] **Step 2: Run failing creation tests**

```bash
node --import tsx --test src/telegram/role-game-flow.test.ts
```

Expected: FAIL because create flow steps are missing.

- [ ] **Step 3: Implement create flow**

Use existing conversation session storage patterns. Flow data shape:

```ts
interface RoleGameCreateDraft {
  type?: RoleGameType;
  title?: string;
  system?: string;
  description?: string;
  capacity?: number;
  visibility?: RoleGameVisibility;
  publicJoinPolicy?: RoleGamePublicJoinPolicy;
  entryMode?: RoleGameEntryMode;
  acceptanceMode?: RoleGameAcceptanceMode;
  defaultDurationMinutes?: number;
  defaultTableId?: number | null;
  defaultAttendanceMode?: 'open' | 'closed';
  defaultIsPublicScheduleEvent?: boolean;
  autoAddConfirmedPlayers?: boolean;
  allowPlayerManualScheduling?: boolean;
  schedulingMode?: RoleGameSchedulingMode;
  recurrenceRule?: RoleGameRecurrenceRule | null;
  recurrenceWindowCount?: number;
}
```

Every prompt keyboard includes `Cancelar`. Confirmation uses a highlighted `Confirmar`.

- [ ] **Step 4: Add request/acceptance tests**

Test that:

- `auto_until_full` confirms while capacity remains
- `manual_review` creates `requested`
- coorganizer/admin/GM can accept
- non-manager cannot accept

- [ ] **Step 5: Implement request/acceptance callbacks**

Add callback prefixes:

```ts
requestSeat: 'role_game:request:',
acceptRequest: 'role_game:accept:',
rejectRequest: 'role_game:reject:',
```

Acceptance updates member status and rerenders detail.

- [ ] **Step 6: Run tests**

```bash
node --import tsx --test src/role-games/role-game-catalog.test.ts src/telegram/role-game-flow.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/role-games/role-game-catalog.ts src/role-games/role-game-catalog.test.ts src/telegram/role-game-flow.ts src/telegram/role-game-keyboards.ts src/telegram/role-game-presentation.ts src/telegram/role-game-flow.test.ts
git commit -m "feat: create and join role games"
```

---

### Task 5: Agenda-Backed One-Shots And Manual Sessions

**Files:**
- Create: `src/role-games/role-game-scheduler.ts`
- Create: `src/role-games/role-game-scheduler.test.ts`
- Modify: `src/telegram/role-game-flow.ts`
- Modify: `src/telegram/role-game-flow.test.ts`
- Reference: `src/schedule/schedule-catalog.ts` for the existing `createScheduleEvent` and participant APIs.

**Interfaces:**
- Consumes: `ScheduleRepository.createEvent`, `ScheduleRepository.upsertParticipant`, `RoleGameRepository.createSessionLink`.
- Produces:
  - `createRoleGameScheduleSession(input)`
  - `createManualRoleGameSession(input)`

- [ ] **Step 1: Write scheduler tests**

Create tests:

```ts
test('createManualRoleGameSession creates an Agenda event with game defaults', async () => {
  const roleGameRepository = createMemoryRoleGameRepository();
  const scheduleRepository = createMemoryScheduleRepository();
  const game = sampleGame({ title: 'Blades', defaultDurationMinutes: 150, capacity: 4 });

  const session = await createManualRoleGameSession({
    roleGameRepository,
    scheduleRepository,
    game,
    startsAt: '2026-08-06T18:00:00.000+02:00',
    actorTelegramUserId: 42,
  });

  assert.equal(session.event.title, 'Blades');
  assert.equal(session.event.durationMinutes, 150);
  assert.equal(session.link.roleGameId, game.id);
});
```

Add auto-attendance test for confirmed players.

- [ ] **Step 2: Run failing scheduler tests**

```bash
node --import tsx --test src/role-games/role-game-scheduler.test.ts
```

Expected: FAIL because scheduler file does not exist.

- [ ] **Step 3: Implement scheduler**

`createManualRoleGameSession` builds a `createScheduleEvent` input from the game:

```ts
const event = await createScheduleEvent({
  repository: scheduleRepository,
  title: game.title,
  description: game.description,
  startsAt,
  durationMinutes: game.defaultDurationMinutes,
  organizerTelegramUserId: game.primaryGmTelegramUserId,
  createdByTelegramUserId: actorTelegramUserId,
  tableId: tableId ?? game.defaultTableId,
  attendanceMode: game.defaultAttendanceMode,
  isPublic: game.defaultIsPublicScheduleEvent,
  initialOccupiedSeats: 0,
  capacity: game.capacity,
});
```

Then insert `role_game_sessions`. If auto-add is active, list confirmed player members and call `upsertParticipant`.

- [ ] **Step 4: Wire one-shot creation**

Extend create flow so one-shot asks date/time and creates the first Agenda event during confirmation. Store `source = 'one_shot_initial'`.

- [ ] **Step 5: Wire manual session action**

In detail, show `Programar siguiente sesión` to GM/coorganizer/admin and confirmed players when `allowPlayerManualScheduling` is true. Prompt day/time, then create the event and render success with a deep link to Agenda detail.

- [ ] **Step 6: Run tests**

```bash
node --import tsx --test src/role-games/role-game-scheduler.test.ts src/telegram/role-game-flow.test.ts src/schedule/schedule-catalog.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/role-games/role-game-scheduler.ts src/role-games/role-game-scheduler.test.ts src/telegram/role-game-flow.ts src/telegram/role-game-flow.test.ts
git commit -m "feat: create role game sessions"
```

---

### Task 6: Recurring Campaign Window

**Files:**
- Modify: `src/role-games/role-game-scheduler.ts`
- Modify: `src/role-games/role-game-scheduler.test.ts`
- Modify: `src/telegram/role-game-flow.ts`
- Modify: `src/telegram/role-game-flow.test.ts`
- Modify: `src/bootstrap/create-app.ts` to start and stop the role-game recurrence worker next to the existing schedule reminder worker.
- Modify: `src/bootstrap/create-app.test.ts` to cover worker lifecycle registration.

**Interfaces:**
- Produces:
  - `ensureRecurringRoleGameSessions(input): Promise<{ created: number; skipped: number }>`
  - `computeUpcomingRoleGameOccurrences(input): string[]`

- [ ] **Step 1: Write recurrence tests**

Test:

- every Thursday at 18:00 creates future occurrences
- every 2 Wednesdays at 18:30 skips alternating weeks
- window count 3 maintains exactly 3 future linked sessions
- cancelled linked session is not recreated

- [ ] **Step 2: Run failing recurrence tests**

```bash
node --import tsx --test src/role-games/role-game-scheduler.test.ts
```

Expected: FAIL because recurrence helpers are missing.

- [ ] **Step 3: Implement recurrence computation**

Represent rule as:

```ts
export interface RoleGameRecurrenceRule {
  intervalWeeks: number;
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  time: string;
}
```

`computeUpcomingRoleGameOccurrences` returns ISO strings after `now`, using the configured local time. Keep implementation deterministic by passing `now` and timezone/local clock assumptions explicitly in tests.

- [ ] **Step 4: Implement window maintenance**

`ensureRecurringRoleGameSessions`:

- loads existing future session links
- counts only non-cancelled Agenda events
- creates missing occurrences until `recurrenceWindowCount`
- skips occurrences that have an existing link to a cancelled event
- returns created/skipped counts

- [ ] **Step 5: Wire Telegram configuration**

Creation flow for recurring campaigns asks:

- interval weeks
- weekday
- time
- window count

Detail action `Configurar recurrencia` lets GM/admin/coorganizer update it. If changing a rule while future sessions exist, show a confirmation summary before saving.

- [ ] **Step 6: Run tests**

```bash
node --import tsx --test src/role-games/role-game-scheduler.test.ts src/telegram/role-game-flow.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/role-games/role-game-scheduler.ts src/role-games/role-game-scheduler.test.ts src/telegram/role-game-flow.ts src/telegram/role-game-flow.test.ts
git commit -m "feat: maintain recurring role game sessions"
```

---

### Task 7: Hidden Storage Infrastructure For Handouts

**Files:**
- Create: `src/storage/storage-internal-purpose.ts`
- Create: `src/storage/storage-internal-purpose.test.ts`
- Modify: `src/storage/storage-catalog.ts`
- Modify: `src/storage/storage-catalog-store.ts`
- Modify: `src/storage/storage-catalog-store.test.ts`
- Modify: `src/telegram/storage-flow.test.ts`
- Modify: LLM Storage search handler file, found by `rg -n "storage.search|searchEntryDetails|Storage" src/telegram src/llm src`

**Interfaces:**
- Produces:
  - `internalRoleGameHandoutPurpose = 'role_game_handouts'`
  - `isUserVisibleStorageCategoryPurpose(purpose)`
  - `createInternalRoleGameStorageEntry(...)` or a repository-level path that tags entries as internal.

- [ ] **Step 1: Add failing Storage filtering tests**

In `storage-catalog-store.test.ts`, create a category or entry with purpose `role_game_handouts` and assert:

```ts
assert.equal(listedCategories.some((category) => category.categoryPurpose === 'role_game_handouts'), false);
assert.equal(searchResults.some((detail) => detail.entry.id === hiddenEntry.entry.id), false);
```

Add Telegram storage-flow test that `/storage` does not render internal handout categories.

- [ ] **Step 2: Run failing Storage tests**

```bash
node --import tsx --test src/storage/storage-catalog-store.test.ts src/telegram/storage-flow.test.ts
```

Expected: FAIL because the purpose is unknown or unfiltered.

- [ ] **Step 3: Extend Storage purpose safely**

In `src/storage/storage-catalog.ts`, change:

```ts
export type StorageCategoryPurpose = 'user_uploads' | 'catalog_media' | 'role_game_handouts';
```

Add helper:

```ts
export function isUserVisibleStorageCategoryPurpose(purpose: StorageCategoryPurpose): boolean {
  return purpose === 'user_uploads';
}
```

Use this helper in normal list/search paths. Keep catalog media and role-game handouts hidden from user browsing.

- [ ] **Step 4: Filter LLM Storage searches**

Find the LLM Storage read/search handler and ensure it uses the same visible-purpose filter. Add a focused test in the relevant LLM test file that a query for a hidden handout title returns no Storage result.

- [ ] **Step 5: Run tests**

```bash
node --import tsx --test src/storage/storage-catalog-store.test.ts src/telegram/storage-flow.test.ts
node --import tsx --test src/telegram/llm-command-flow.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/storage/storage-internal-purpose.ts src/storage/storage-internal-purpose.test.ts src/storage/storage-catalog.ts src/storage/storage-catalog-store.ts src/storage/storage-catalog-store.test.ts src/telegram/storage-flow.test.ts src/telegram/llm-command-flow.test.ts src/telegram/llm-command-flow.ts
git commit -m "feat: hide role game handouts from storage"
```

Stage `src/telegram/llm-command-read-actions.ts` when LLM Storage filtering changes.

---

### Task 8: Handout Upload, Visibility, And Delivery

**Files:**
- Modify: `src/role-games/role-game-catalog.ts`
- Modify: `src/role-games/role-game-catalog-store.ts`
- Modify: `src/telegram/role-game-flow.ts`
- Modify: `src/telegram/role-game-flow.test.ts`
- Modify: `src/telegram/role-game-presentation.ts`
- Modify: `src/telegram/role-game-keyboards.ts`

**Interfaces:**
- Consumes: hidden Storage infrastructure from Task 7.
- Produces:
  - `createRoleGameMaterial(input)`
  - `revealRoleGameMaterial(input)`
  - `recordRoleGameMaterialDelivery(input)`
  - Telegram actions `Enviar sólo esta vez`, `Enviar y revelar`, `Revelar sin enviar`.

- [ ] **Step 1: Add failing handout flow tests**

Test:

- GM uploads `gm_only` material
- player cannot see it in detail
- GM sees it
- `Enviar sólo esta vez` sends to confirmed players and leaves hidden
- `Enviar y revelar` sends and then players see it
- partial send failure reports summary

- [ ] **Step 2: Run failing tests**

```bash
node --import tsx --test src/telegram/role-game-flow.test.ts src/role-games/role-game-catalog.test.ts
```

Expected: FAIL because handout functions/actions are missing.

- [ ] **Step 3: Implement material use cases**

Add domain methods to create/update materials, enforce visibility, and record delivery. Access helper:

```ts
export function canViewRoleGameMaterial(actor: RoleGameActor, game: RoleGameRecord, member: RoleGameMemberRecord | null, material: RoleGameMaterialRecord): boolean {
  if (actor.isAdmin || actor.telegramUserId === game.primaryGmTelegramUserId) return true;
  if (member?.role === 'coorganizer' && member.status === 'confirmed') return true;
  return material.visibility === 'players' && member?.status === 'confirmed';
}
```

- [ ] **Step 4: Implement upload flow**

Use Storage copy/create-entry helpers but force purpose `role_game_handouts`. Use editable progress for copy/index steps. Do not expose `storage_entry_<id>` in user-facing messages.

- [ ] **Step 5: Implement delivery actions**

For each confirmed player:

- send description
- copy/send the stored Telegram file
- record delivery `sent` or `failed`

If action is `send_and_reveal`, update material visibility to `players`.

- [ ] **Step 6: Run tests**

```bash
node --import tsx --test src/telegram/role-game-flow.test.ts src/role-games/role-game-catalog.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/role-games/role-game-catalog.ts src/role-games/role-game-catalog-store.ts src/telegram/role-game-flow.ts src/telegram/role-game-flow.test.ts src/telegram/role-game-presentation.ts src/telegram/role-game-keyboards.ts
git commit -m "feat: manage role game handouts"
```

---

### Task 9: Public One-Shot External Access

**Files:**
- Modify: `src/telegram/role-game-flow.ts`
- Modify: `src/telegram/role-game-flow.test.ts`
- Modify: `src/telegram/runtime-boundary-registration.ts`
- Modify: `src/telegram/runtime-boundary.test.ts`
- Modify: `src/role-games/role-game-catalog.ts`
- Modify: `src/role-games/role-game-catalog.test.ts`

**Interfaces:**
- Consumes: visibility and request logic from earlier tasks.
- Produces external deep-link behavior for `role_game_<id>`.

- [ ] **Step 1: Add failing external tests**

Test:

- unapproved Telegram user can open public game with `members_and_external`
- unapproved user cannot open private/member-only game
- external request does not approve membership
- external confirmed player can receive revealed handouts only for that game

- [ ] **Step 2: Run failing tests**

```bash
node --import tsx --test src/telegram/role-game-flow.test.ts src/telegram/runtime-boundary.test.ts src/role-games/role-game-catalog.test.ts
```

Expected: FAIL because runtime blocks or flow rejects externals.

- [ ] **Step 3: Relax only role-game public start paths**

In runtime/start handling, allow `/start role_game_<id>` to reach the role-game handler for unapproved users. Inside the handler, apply `canViewRoleGame`.

Do not relax:

- root `Rol` menu
- `/rol`
- private member lists
- Storage
- edit/manage callbacks

- [ ] **Step 4: Implement external request path**

`requestRoleGameSeat` accepts `isExternal: true` only when:

- game visibility is `public`
- `publicJoinPolicy = 'members_and_external'`
- game status is `active`

Keep `users.status` unchanged.

- [ ] **Step 5: Run tests**

```bash
node --import tsx --test src/telegram/role-game-flow.test.ts src/telegram/runtime-boundary.test.ts src/role-games/role-game-catalog.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/telegram/role-game-flow.ts src/telegram/role-game-flow.test.ts src/telegram/runtime-boundary-registration.ts src/telegram/runtime-boundary.test.ts src/role-games/role-game-catalog.ts src/role-games/role-game-catalog.test.ts
git commit -m "feat: allow public role game signups"
```

---

### Task 10: Documentation, Feature Status, And Final Validation

**Files:**
- Modify: `docs/feature-status.md`
- Modify: `docs/llm-natural-language.md` only if LLM Storage filtering code changed visible LLM behavior.
- Modify: any test fixtures that assert root menu rows.

**Interfaces:**
- Consumes all prior tasks.
- Produces final validated branch ready for review.

- [ ] **Step 1: Update feature inventory**

In `docs/feature-status.md`:

- add `Rol / partidas` to the fixed-width summary table
- add a section describing campaigns, one-shots, sessions via Agenda, hidden handouts, and public one-shot access
- update test coverage table with `src/telegram/role-game-flow.test.ts`, `src/role-games/role-game-catalog.test.ts`, `src/role-games/role-game-catalog-store.test.ts`, `src/role-games/role-game-scheduler.test.ts`

- [ ] **Step 2: Run feature status audit**

```bash
./scripts/feature-status-audit.sh
```

Expected: PASS or audit guidance that the touched sections have been reviewed.

- [ ] **Step 3: Run targeted tests**

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

Expected: PASS.

- [ ] **Step 4: Run global checks**

```bash
npm run typecheck
npm run db:check
./scripts/feature-status-audit.sh
./startup.sh
```

Expected:

- typecheck passes
- db check passes
- feature audit passes
- startup completes and restarts `gameclubtelegrambot.service`

- [ ] **Step 5: Inspect service health**

```bash
systemctl is-active gameclubtelegrambot.service
curl -fsS http://127.0.0.1:8787/ >/tmp/gameclub-role-games-health.html
```

Expected:

- `systemctl` prints `active`
- `curl` exits 0

- [ ] **Step 6: Commit docs and validation fixes**

```bash
git add docs/feature-status.md docs/llm-natural-language.md src/telegram/*.test.ts src/role-games/*.test.ts src/storage/*.test.ts
git commit -m "docs: document role games feature status"
```

Before committing, run `git status --short` and stage only paths with changes from this task.

---

## Self-Review Checklist

- Spec coverage:
  - `Rol` root menu: Task 3.
  - Create campaigns/one-shots: Task 4.
  - Agenda-backed sessions: Task 5.
  - Recurrence window: Task 6.
  - Hidden Storage handouts: Task 7.
  - Handout delivery/reveal: Task 8.
  - Public one-shot external access: Task 9.
  - Feature status and startup validation: Task 10.
- Placeholder scan:
  - No task may leave implementation unnamed; each task names the function, file, command, and expected behavior.
- Type consistency:
  - Use `role_games` DB tables, `RoleGame*` domain types, and `role_game_*` deep-link payloads throughout.
- Validation:
  - Because schema changes are included, final validation includes `npm run db:check`.
  - Because visible bot behavior and docs change, final validation includes `./scripts/feature-status-audit.sh` and `./startup.sh`.
