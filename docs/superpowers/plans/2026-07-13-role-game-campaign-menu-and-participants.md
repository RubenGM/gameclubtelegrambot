# Role Game Campaign Menu and Participants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline campaign-detail controls with persistent Telegram reply-keyboard sections and add complete, permission-aware participant management for primary GMs and admins.

**Architecture:** Keep role-game membership rules in `src/role-games`, expose atomic repository transitions for seat confirmation and role changes, and make Telegram navigation session-backed. Add a focused participant-presentation module so the already-large flow file only orchestrates repository, membership-profile, keyboard, and notification operations.

**Tech Stack:** TypeScript, Node test runner, Drizzle ORM/PostgreSQL, existing Telegram runtime abstractions, existing conversation-session runtime.

## Global Constraints

- Preserve the permission split: `canManageRoleGame` is primary GM/admin; `canManageRoleGameOperationally` additionally includes confirmed coorganizers.
- Do not expose role-game handouts through generic Storage paths or change `role_game_<id>` / `role_material_<id>` deep links.
- Keep public external one-shot access working exactly as before.
- Use persistent reply keyboards for the campaign dashboard and its section menus; keep old inline callbacks registered for messages sent before deployment.
- Localize every visible label and response in Catalan, Spanish, and English.
- Follow `docs/telegram-pagination-style.md`: recalculate totals, bound pages, show localized `Mostrando X-Y de Z. Página A/B.` footers, and expose only valid previous/next controls.
- Preserve natural Spanish and Catalan orthography.
- Update `docs/feature-status.md` for this visible behavior change.
- After code changes, run `./startup.sh` before handoff.

---

### Task 1: Atomic participant transitions and role changes

**Files:**
- Modify: `src/role-games/role-game-catalog.ts`
- Modify: `src/role-games/role-game-catalog-store.ts`
- Test: `src/role-games/role-game-catalog.test.ts`
- Test: `src/role-games/role-game-catalog-store.test.ts`
- Modify fakes if required: `src/role-games/role-game-scheduler.test.ts`, `src/telegram/storage-flow.test.ts`, `src/telegram/role-game-flow.test.ts`

**Interfaces:**
- Consumes: existing `RoleGameMemberRecord`, `RoleGameMemberRole`, `RoleGameMemberStatus`, `canManageRoleGame`, and row-locking transaction pattern in `requestSeat`.
- Produces: `RoleGameMemberManagementAction`, `manageRoleGameMember(...)`, `RoleGameRepository.confirmMemberSeat(...)`, and `RoleGameRepository.setMemberRole(...)`.

- [ ] **Step 1: Write failing domain tests for every allowed and rejected transition**

Add table-driven tests that exercise real domain functions:

```ts
const fullManager = { telegramUserId: 42, isAdmin: false, isApproved: true };

test('manageRoleGameMember confirms requested, invited and waitlisted players', async () => {
  for (const status of ['requested', 'invited', 'waitlisted'] as const) {
    const repository = createMemoryRoleGameRepository();
    const game = await repository.createGame(sampleCreateInput());
    const member = await repository.createMember({
      roleGameId: game.id,
      telegramUserId: 100,
      role: 'player',
      status,
      isExternal: false,
      requestedByTelegramUserId: 100,
    });
    const updated = await manageRoleGameMember({
      repository,
      actor: fullManager,
      game,
      actorMembership: null,
      member,
      action: 'confirm',
    });
    assert.equal(updated.status, 'confirmed');
  }
});

test('manageRoleGameMember prevents coorganizers from changing roles or removing players', async () => {
  await assert.rejects(
    manageRoleGameMember({
      repository,
      actor: { telegramUserId: 77, isAdmin: false, isApproved: true },
      game,
      actorMembership: sampleMember({ telegramUserId: 77, role: 'coorganizer', status: 'confirmed' }),
      member: sampleMember({ telegramUserId: 100, role: 'player', status: 'confirmed' }),
      action: 'promote',
    }),
    /permission/i,
  );
});
```

Also cover `reject`, `remove`, `cancel_invitation`, `promote`, `demote`, primary-GM protection, stale source status, and no-capacity confirmation.

- [ ] **Step 2: Run domain tests and verify RED**

Run:

```bash
node --import tsx --test src/role-games/role-game-catalog.test.ts
```

Expected: FAIL because `manageRoleGameMember`, `confirmMemberSeat`, and `setMemberRole` do not exist.

- [ ] **Step 3: Add explicit domain and repository contracts**

Add these contracts to `role-game-catalog.ts`:

```ts
export type RoleGameMemberManagementAction =
  | 'confirm'
  | 'reject'
  | 'remove'
  | 'cancel_invitation'
  | 'promote'
  | 'demote';

export interface RoleGameRepository {
  confirmMemberSeat(input: {
    memberId: number;
    actorTelegramUserId: number;
    expectedStatuses: Array<'requested' | 'invited' | 'waitlisted'>;
  }): Promise<RoleGameMemberRecord>;
  setMemberRole(input: {
    memberId: number;
    role: 'player' | 'coorganizer';
    actorTelegramUserId: number;
  }): Promise<RoleGameMemberRecord>;
}
```

Implement `manageRoleGameMember` so it reloads the current game and member, verifies the member belongs to the game, protects `primary_gm`, applies `canManageRoleGame` for remove/promote/demote/cancel and `canManageRoleGameOperationally` for request acceptance/rejection, and delegates `confirm` to the atomic repository operation.

- [ ] **Step 4: Implement atomic database writes and store tests**

Implement `confirmMemberSeat` using one transaction:

```ts
async confirmMemberSeat(input) {
  return database.transaction(async (tx) => {
    const [member] = await tx.select().from(roleGameMembers)
      .where(eq(roleGameMembers.id, input.memberId))
      .limit(1)
      .for('update');
    if (
      !member ||
      member.role !== 'player' ||
      !input.expectedStatuses.includes(member.status as 'requested' | 'invited' | 'waitlisted')
    ) {
      throw new Error(`Role game member ${input.memberId} has stale status`);
    }
    const [game] = await tx.select().from(roleGames)
      .where(eq(roleGames.id, member.roleGameId))
      .limit(1)
      .for('update');
    if (!game) throw new Error(`Role game ${member.roleGameId} not found`);
    const [confirmed] = await tx.select({ count: count() }).from(roleGameMembers)
      .where(and(
        eq(roleGameMembers.roleGameId, game.id),
        eq(roleGameMembers.role, 'player'),
        eq(roleGameMembers.status, 'confirmed'),
      ));
    if (Number(confirmed?.count ?? 0) >= game.capacity) {
      throw new Error(`Role game ${game.id} is full`);
    }
    const rows = await tx.update(roleGameMembers)
      .set({
        status: 'confirmed',
        requestedByTelegramUserId: input.actorTelegramUserId,
        updatedAt: new Date(),
      })
      .where(and(
        eq(roleGameMembers.id, member.id),
        eq(roleGameMembers.status, member.status),
      ))
      .returning();
    const updated = rows[0];
    if (!updated) throw new Error(`Role game member ${member.id} has stale status`);
    return mapRoleGameMemberRow(updated);
  });
}
```

Use the query-builder shape supported by the existing test database fake; if an inner join is not supported there, lock the member row first, then lock its game row in the same transaction. Implement `setMemberRole` with an update constrained to a confirmed non-primary member. Store tests must assert row locking happens before capacity count and that stale status leaves the row unchanged.

- [ ] **Step 5: Run domain/store tests and update all repository fakes**

Run:

```bash
node --import tsx --test src/role-games/role-game-catalog.test.ts src/role-games/role-game-catalog-store.test.ts src/role-games/role-game-scheduler.test.ts src/telegram/storage-flow.test.ts src/telegram/role-game-flow.test.ts
```

Expected: PASS with no missing repository-method errors.

- [ ] **Step 6: Commit the domain slice**

```bash
git add src/role-games/role-game-catalog.ts src/role-games/role-game-catalog-store.ts src/role-games/role-game-catalog.test.ts src/role-games/role-game-catalog-store.test.ts src/role-games/role-game-scheduler.test.ts src/telegram/storage-flow.test.ts src/telegram/role-game-flow.test.ts
git commit -m "feat: add role game participant transitions"
```

---

### Task 2: Campaign dashboard and section reply keyboards

**Files:**
- Modify: `src/telegram/role-game-keyboards.ts`
- Modify: `src/telegram/role-game-flow.ts`
- Modify: `src/telegram/i18n-role-games.ts`
- Test: `src/telegram/role-game-flow.test.ts`

**Interfaces:**
- Consumes: existing detail formatter, permission helpers, schedule/material/invite/edit handlers, and conversation-session runtime.
- Produces: `role-game-detail` session state, `buildRoleGameDashboardKeyboard(...)`, `buildRoleGameSessionsKeyboard(...)`, `buildRoleGameMaterialsKeyboard(...)`, and `buildRoleGameConfigurationKeyboard(...)`.

- [ ] **Step 1: Write failing dashboard tests**

Add tests asserting the detail has no inline keyboard and the reply keyboard is permission-sensitive:

```ts
test('role game detail uses a persistent section keyboard without inline buttons', async () => {
  const context = createRoleGameContext({ game, actorTelegramUserId: game.primaryGmTelegramUserId });
  await handleTelegramRoleGameStartText({ ...context, messageText: `/start role_game_${game.id}` });
  assert.equal(context.replyOptions.at(-1)?.inlineKeyboard, undefined);
  assert.deepEqual(
    context.replyOptions.at(-1)?.replyKeyboard?.map((row) => row.map((button) => button.text)),
    [
      ['Participantes'],
      ['Sesiones', 'Materiales'],
      ['Invitar', 'Configurar'],
      ['Volver a mis partidas'],
      ['Inicio', 'Ayuda'],
    ],
  );
});
```

Add variants for coorganizer, confirmed player, visitor who may request a seat, recurring/manual campaign, and public external one-shot.

- [ ] **Step 2: Run the Telegram test and verify RED**

```bash
node --import tsx --test src/telegram/role-game-flow.test.ts
```

Expected: FAIL because detail still emits `buildRoleGameDetailInlineKeyboard`.

- [ ] **Step 3: Implement the dashboard session and keyboard builders**

Use stable localized button labels and session data:

```ts
interface RoleGameDetailSessionData {
  gameId: number;
  view: 'dashboard' | 'sessions' | 'materials' | 'configuration';
}

await context.runtime.session.start({
  flowKey: 'role-game-detail',
  stepKey: 'dashboard',
  data: { gameId: game.id, view: 'dashboard' } satisfies RoleGameDetailSessionData,
});
```

`buildRoleGameDashboardKeyboard` must receive explicit booleans (`canManageParticipants`, `canSchedule`, `canManageMaterials`, `canConfigure`, `canRequestSeat`) and `pendingRequestCount`. It must always include `Volver a mis partidas`, `Inicio`, and `Ayuda`.

- [ ] **Step 4: Route section button text to existing behavior**

In `handleTelegramRoleGameText`, resolve the current `role-game-detail` session before the generic `Rol` home actions. `Invitar` calls the existing invitation response. `Configurar` opens a keyboard containing `Editar partida`, recurrence when valid, and `Volver a la partida`. `Sesiones` renders linked sessions and exposes manual scheduling only when `canScheduleManualRoleGameSession` permits it. `Materiales` opens a reply-keyboard list and upload action while preserving `role_material_<id>` links.

- [ ] **Step 5: Keep old callbacks as compatibility adapters**

Leave every current `role_game:*` prefix registered. Replace successful callback responses with the same new dashboard or section renderers used by text navigation. Stale callbacks must still perform fresh permission checks.

- [ ] **Step 6: Run tests and commit**

```bash
node --import tsx --test src/telegram/role-game-flow.test.ts
git add src/telegram/role-game-keyboards.ts src/telegram/role-game-flow.ts src/telegram/i18n-role-games.ts src/telegram/role-game-flow.test.ts
git commit -m "feat: add role game section keyboards"
```

Expected: all role-game flow tests PASS.

---

### Task 3: Participant presentation, identity resolution, lists, and history

**Files:**
- Create: `src/telegram/role-game-participants.ts`
- Create: `src/telegram/role-game-participants.test.ts`
- Modify: `src/telegram/role-game-flow.ts`
- Modify: `src/telegram/role-game-keyboards.ts`
- Modify: `src/telegram/i18n-role-games.ts`
- Modify: `src/telegram/role-game-flow.test.ts`

**Interfaces:**
- Consumes: `RoleGameMemberRecord`, `MembershipAccessRepository.findUserByTelegramUserId`, `formatTelegramUserLink`, and the pagination style guide.
- Produces: `RoleGameParticipantListItem`, `buildRoleGameParticipantPage(...)`, `formatRoleGameParticipantList(...)`, and `buildRoleGameParticipantsKeyboard(...)`.

- [ ] **Step 1: Write failing pure presentation tests**

Cover grouping/order, active/history split, duplicate names, fallback identity, and pagination:

```ts
test('participant page orders requests, waitlist, coorganizers, players and invited', () => {
  const page = buildRoleGameParticipantPage({ items, kind: 'active', requestedPage: 1, pageSize: 6 });
  assert.deepEqual(page.items.map((item) => item.member.status), [
    'requested', 'waitlisted', 'confirmed', 'confirmed', 'invited',
  ]);
});

test('participant buttons disambiguate duplicate display names', () => {
  const labels = buildRoleGameParticipantButtonMap([
    participant({ memberId: 4, displayName: 'Alex', username: null }),
    participant({ memberId: 9, displayName: 'Alex', username: null }),
  ]);
  assert.deepEqual([...labels.keys()], ['Alex · #4', 'Alex · #9']);
});
```

- [ ] **Step 2: Run presentation tests and verify RED**

```bash
node --import tsx --test src/telegram/role-game-participants.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure participant presentation module**

Define:

```ts
export interface RoleGameParticipantListItem {
  member: RoleGameMemberRecord;
  displayName: string;
  username: string | null;
}

export interface RoleGameParticipantPage {
  items: RoleGameParticipantListItem[];
  page: number;
  pages: number;
  total: number;
  from: number;
  to: number;
}
```

Use active statuses `requested`, `waitlisted`, `confirmed`, `invited`; history statuses `left`, `removed`, `rejected`; page size 6; deterministic tie-breakers by localized display name and member ID. Return a label-to-member-ID map for only the rendered page.

- [ ] **Step 4: Resolve profiles and render participant/history views**

Extend `TelegramRoleGameContext` with optional `membershipRepository?: MembershipAccessRepository`. Resolve it with `createDatabaseMembershipAccessRepository` when absent. Fetch profiles with `Promise.all`; fall back to `Usuario <telegramUserId>` and equivalent localized labels if no profile exists.

Store session data shaped as:

```ts
interface RoleGameParticipantsSessionData {
  gameId: number;
  view: 'participants' | 'history' | 'participant-detail' | 'confirm-action';
  page: number;
  memberButtons: Record<string, number>;
  selectedMemberId?: number;
  pendingAction?: RoleGameMemberManagementAction;
}
```

The list message uses HTML links for usernames where available, grouped headings, and the exact localized footer when pages > 1. The reply keyboard renders one participant button per row plus valid pagination, `Historial`/`Participantes actuales`, `Volver a la partida`, `Inicio`, and `Ayuda`.

- [ ] **Step 5: Add flow tests for first/next/previous pages and history**

Verify current-page state is bounded after members disappear, only valid nav buttons render, historical members never appear in active pages, and forged labels not present in `memberButtons` do not select a user.

- [ ] **Step 6: Run tests and commit**

```bash
node --import tsx --test src/telegram/role-game-participants.test.ts src/telegram/role-game-flow.test.ts
git add src/telegram/role-game-participants.ts src/telegram/role-game-participants.test.ts src/telegram/role-game-flow.ts src/telegram/role-game-keyboards.ts src/telegram/i18n-role-games.ts src/telegram/role-game-flow.test.ts
git commit -m "feat: list role game participants"
```

---

### Task 4: Participant detail actions, confirmations, and notifications

**Files:**
- Modify: `src/telegram/role-game-participants.ts`
- Modify: `src/telegram/role-game-flow.ts`
- Modify: `src/telegram/role-game-keyboards.ts`
- Modify: `src/telegram/i18n-role-games.ts`
- Test: `src/telegram/role-game-flow.test.ts`

**Interfaces:**
- Consumes: `manageRoleGameMember(...)`, participant session state, runtime `sendPrivateMessage`, and structured logger.
- Produces: permission-aware participant detail keyboard, confirmation state, best-effort notification helper, and stale-state recovery.

- [ ] **Step 1: Write failing action-permission tests**

Add one test per matrix row:

```ts
test('primary GM can promote a confirmed player after confirmation', async () => {
  const { context, repository } = createParticipantManagementContext({ game, member: confirmedPlayer });
  await openParticipant(context, confirmedPlayer.id);
  await handleTelegramRoleGameText({ ...context, messageText: 'Hacer coorganizador' });
  assert.match(lastReply(context), /confirm/i);
  await handleTelegramRoleGameText({ ...context, messageText: 'Confirmar' });
  assert.equal((await repository.findMemberById(confirmedPlayer.id))?.role, 'coorganizer');
});
```

Cover coorganizer accept/reject only, admin full management, GM protection, stale status, full capacity, cancel invitation, remove waitlisted/confirmed, demote coorganizer, and history read-only.

- [ ] **Step 2: Run the flow test and verify RED**

```bash
node --import tsx --test src/telegram/role-game-flow.test.ts
```

Expected: FAIL because participant detail/action routing is absent.

- [ ] **Step 3: Implement action availability and confirmation keyboards**

Use one pure resolver:

```ts
export function listRoleGameMemberActions(input: {
  actor: RoleGameActor;
  game: RoleGameRecord;
  actorMembership: RoleGameMemberRecord | null;
  member: RoleGameMemberRecord;
}): RoleGameMemberManagementAction[];
```

Map actions exactly as approved: requested -> confirm/reject; waitlisted -> confirm/remove; invited -> confirm/cancel invitation; confirmed player -> promote/remove; confirmed coorganizer -> demote/remove; primary GM/history -> none. Coorganizers receive confirm/reject only for requested members.

- [ ] **Step 4: Execute confirmed actions with fresh reads and safe recovery**

On `Confirmar`, reload game, actor membership, and selected member; call `manageRoleGameMember`; clear `pendingAction`; then render the updated participant list. Map known domain errors to localized full/stale/permission/not-found responses. Never trust the member role/status stored in session.

- [ ] **Step 5: Add best-effort private notifications**

After persistence, call:

```ts
await context.runtime.bot.sendPrivateMessage(
  updated.telegramUserId,
  formatRoleGameMemberChangeNotification({ game, action, language }),
);
```

Wrap only the send in `try/catch`. Log `{ gameId, memberId, recipientTelegramUserId, action, error }` with a warning and keep the successful domain change. Tests must assert both successful send and non-rollback on failure.

- [ ] **Step 6: Run tests and commit**

```bash
node --import tsx --test src/role-games/role-game-catalog.test.ts src/telegram/role-game-participants.test.ts src/telegram/role-game-flow.test.ts
git add src/telegram/role-game-participants.ts src/telegram/role-game-flow.ts src/telegram/role-game-keyboards.ts src/telegram/i18n-role-games.ts src/telegram/role-game-flow.test.ts
git commit -m "feat: manage role game participants"
```

---

### Task 5: Full regression, feature inventory, and live deployment validation

**Files:**
- Modify: `docs/feature-status.md`
- Test: existing role-game, Storage, runtime-boundary, and schedule suites

**Interfaces:**
- Consumes: completed participant/domain/navigation slices.
- Produces: operational documentation and a deployed, restarted bot.

- [ ] **Step 1: Update the feature inventory**

In the fixed-width executive summary, keep `Rol / partidas de rol` as `🟢 Operativo` and update its reading to mention the reply-keyboard campaign dashboard and participant management. In the detailed Rol section add:

```markdown
- El detalle de partida funciona como portada con teclado persistente y submenús de Participantes, Sesiones, Materiales, Invitar y Configurar, sin depender de acciones inline bajo el mensaje.
- GM principal y admins gestionan solicitudes, listas de espera, invitaciones, jugadores y coorganizadores; los coorganizadores sólo conservan la resolución operativa de solicitudes.
- Participantes activos e historial separado se muestran con identidad visible, estados y paginación de teclado.
```

- [ ] **Step 2: Run targeted regression tests**

```bash
node --import tsx --test \
  src/role-games/role-game-catalog.test.ts \
  src/role-games/role-game-catalog-store.test.ts \
  src/role-games/role-game-scheduler.test.ts \
  src/telegram/role-game-participants.test.ts \
  src/telegram/role-game-flow.test.ts \
  src/telegram/storage-flow.test.ts
```

Expected: all tests PASS, zero failures.

- [ ] **Step 3: Run repository-wide static and inventory checks**

```bash
npm run typecheck
./scripts/feature-status-audit.sh
git diff --check
```

Expected: typecheck exits 0, inventory audit prints the maintained feature status, and diff check is silent.

- [ ] **Step 4: Commit documentation and final integration adjustments**

```bash
git add docs/feature-status.md src/role-games src/telegram
git commit -m "docs: record role game participant management"
```

Skip this commit if Task 5 only verifies already-committed files and documentation was included in the preceding implementation commit.

- [ ] **Step 5: Deploy and verify runtime**

```bash
./startup.sh
systemctl is-active gameclubtelegrambot.service
curl -fsS http://127.0.0.1:8787/
./scripts/service-journal.sh -n 120
```

Expected: startup completes, service reports `active`, the Admin HTTP root responds successfully to GET, and the journal contains no new role-game startup errors.

- [ ] **Step 6: Inspect final git state**

```bash
git status --short --branch
git log -8 --oneline --decorate
```

Expected: only `.superpowers/` may remain untracked from the approved visual brainstorming companion; no implementation or documentation files remain uncommitted.
