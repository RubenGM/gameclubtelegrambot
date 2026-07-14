# Public Schedule Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build public schedule activities that are normal open activities internally, also publish to a separate `/news` category, and allow non-members to view/join only those public activities.

**Architecture:** Add `isPublic` to the schedule domain and database, then reuse the existing news subscription and calendar snapshot pipeline for a filtered public feed. Relax Telegram schedule gates at the deep-link/callback boundary only after loading the target event and proving it is scheduled, open, and public.

**Tech Stack:** TypeScript, Node test runner with `tsx`, Drizzle PostgreSQL schema/migrations, grammY-style Telegram runtime boundary, existing `/news` repositories.

## Global Constraints

- Spanish and Catalan docs/copy may use natural Unicode orthography.
- Public activities must be open tables; closed activities cannot be public.
- Public event subscriptions use a separate `/news` category with `defaultSubscribed: false`.
- Non-member joins must not approve or convert the user into a club member.
- Keep existing internal `events` calendar publication unchanged.
- Update `docs/feature-status.md` for visible/operational behavior changes.
- Run `./scripts/feature-status-audit.sh` and `./startup.sh` before completion.

---

### Task 1: Schedule Domain And Persistence

**Files:**
- Modify: `src/schedule/schedule-catalog.ts`
- Modify: `src/schedule/schedule-catalog-store.ts`
- Modify: `src/infrastructure/database/schema.ts`
- Create: `src/infrastructure/database/drizzle/0037_public_schedule_events.sql`
- Modify: `src/schedule/schedule-catalog.test.ts`
- Modify: `src/schedule/schedule-catalog-store.test.ts`

**Interfaces:**
- Produces: `ScheduleEventRecord.isPublic: boolean`
- Produces: `createScheduleEvent(input: { repository: ScheduleRepository; title: string; description?: string | null; detailsMessageChatId?: number | null; detailsMessageId?: number | null; startsAt: string; durationMinutes: number; organizerTelegramUserId: number; createdByTelegramUserId: number; tableId?: number | null; catalogItemId?: number | null; attendanceMode: ScheduleAttendanceMode; initialOccupiedSeats: number; capacity: number; isPublic?: boolean }): Promise<ScheduleEventRecord>`
- Produces: `updateScheduleEvent(input: { repository: ScheduleRepository; eventId: number; title: string; description?: string | null; detailsMessageChatId?: number | null; detailsMessageId?: number | null; startsAt: string; durationMinutes: number; organizerTelegramUserId: number; tableId?: number | null; catalogItemId?: number | null; attendanceMode: ScheduleAttendanceMode; initialOccupiedSeats: number; capacity: number; isPublic?: boolean }): Promise<ScheduleEventRecord>`

- [ ] **Step 1: Write failing domain tests**

Add tests to `src/schedule/schedule-catalog.test.ts`:

```ts
test('createScheduleEvent allows public open activities', async () => {
  const repository = createInMemoryScheduleRepository();
  const event = await createScheduleEvent({
    repository,
    title: 'Torneo abierto',
    startsAt: '2026-07-10T18:00:00.000Z',
    durationMinutes: 180,
    organizerTelegramUserId: 42,
    createdByTelegramUserId: 42,
    tableId: null,
    attendanceMode: 'open',
    initialOccupiedSeats: 0,
    capacity: 8,
    isPublic: true,
  });

  assert.equal(event.isPublic, true);
});

test('createScheduleEvent rejects public closed activities', async () => {
  const repository = createInMemoryScheduleRepository();

  await assert.rejects(
    createScheduleEvent({
      repository,
      title: 'Mesa cerrada',
      startsAt: '2026-07-10T18:00:00.000Z',
      durationMinutes: 180,
      organizerTelegramUserId: 42,
      createdByTelegramUserId: 42,
      tableId: null,
      attendanceMode: 'closed',
      initialOccupiedSeats: 0,
      capacity: 4,
      isPublic: true,
    }),
    /Una actividad pública debe ser una mesa abierta/,
  );
});

test('updateScheduleEvent rejects public closed activities', async () => {
  const repository = createInMemoryScheduleRepository();
  const event = await createScheduleEvent({
    repository,
    title: 'Mesa abierta',
    startsAt: '2026-07-10T18:00:00.000Z',
    durationMinutes: 180,
    organizerTelegramUserId: 42,
    createdByTelegramUserId: 42,
    tableId: null,
    attendanceMode: 'open',
    initialOccupiedSeats: 0,
    capacity: 4,
    isPublic: false,
  });

  await assert.rejects(
    updateScheduleEvent({
      repository,
      eventId: event.id,
      title: event.title,
      startsAt: event.startsAt,
      durationMinutes: event.durationMinutes,
      organizerTelegramUserId: event.organizerTelegramUserId,
      tableId: event.tableId,
      attendanceMode: 'closed',
      initialOccupiedSeats: 0,
      capacity: event.capacity,
      isPublic: true,
    }),
    /Una actividad pública debe ser una mesa abierta/,
  );
});
```

- [ ] **Step 2: Verify domain tests fail**

Run: `node --import tsx --test src/schedule/schedule-catalog.test.ts`

Expected: FAIL because `isPublic` is not part of the domain types or records.

- [ ] **Step 3: Write failing repository tests**

Add assertions to `src/schedule/schedule-catalog-store.test.ts` so the fake insert/update rows include `isPublic: true`, and assert:

```ts
assert.equal(event.isPublic, true);
assert.equal(values.isPublic, true);
```

Also update existing fake schedule rows to include `isPublic: false` where needed.

- [ ] **Step 4: Verify repository tests fail**

Run: `node --import tsx --test src/schedule/schedule-catalog-store.test.ts`

Expected: FAIL because the Drizzle schema and mapper do not expose `isPublic`.

- [ ] **Step 5: Implement schema and domain**

In `src/infrastructure/database/schema.ts`, add:

```ts
isPublic: boolean('is_public').notNull().default(false),
```

in `scheduleEvents`, after `attendanceMode`.

Create `src/infrastructure/database/drizzle/0037_public_schedule_events.sql`:

```sql
ALTER TABLE "schedule_events" ADD COLUMN "is_public" boolean DEFAULT false NOT NULL;
```

In `src/schedule/schedule-catalog.ts`, add `isPublic: boolean` to `ScheduleEventRecord`, create/update repository input types, function parameters, and pass `isPublic: normalizePublicVisibility({ attendanceMode, isPublic })`.

Add:

```ts
function normalizePublicVisibility({
  attendanceMode,
  isPublic,
}: {
  attendanceMode: ScheduleAttendanceMode;
  isPublic: boolean | undefined;
}): boolean {
  const normalizedAttendanceMode = normalizeAttendanceMode(attendanceMode);
  const normalizedIsPublic = isPublic === true;
  if (normalizedIsPublic && normalizedAttendanceMode !== 'open') {
    throw new Error('Una actividad pública debe ser una mesa abierta');
  }
  return normalizedIsPublic;
}
```

In `src/schedule/schedule-catalog-store.ts`, write/read `isPublic`.

- [ ] **Step 6: Verify Task 1 tests pass**

Run:

```bash
node --import tsx --test src/schedule/schedule-catalog.test.ts
node --import tsx --test src/schedule/schedule-catalog-store.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/schedule/schedule-catalog.ts src/schedule/schedule-catalog-store.ts src/infrastructure/database/schema.ts src/infrastructure/database/drizzle/0037_public_schedule_events.sql src/schedule/schedule-catalog.test.ts src/schedule/schedule-catalog-store.test.ts
git commit -m "feat: add public schedule event persistence"
```

### Task 2: Public News Category And Filtered Snapshot

**Files:**
- Modify: `src/news/news-group-catalog.ts`
- Modify: `src/telegram/calendar-summary.ts`
- Modify: `src/telegram/schedule-notifications.ts`
- Modify: `src/telegram/schedule-flow.test.ts`
- Modify: `src/telegram/calendar-flow.test.ts` if compile fixtures require `isPublic`

**Interfaces:**
- Consumes: `ScheduleEventRecord.isPublic`
- Produces: `publicEventsNewsGroupCategory = 'public-events'`
- Produces: `loadUpcomingCalendarEntries({ database, now, scheduleRepository, venueEventRepository, tableRepository, publicOnly }): Promise<CalendarEntry[]>`
- Produces: `publishPublicCalendarSnapshotToNewsGroups(input: PublishCalendarSnapshotInput): Promise<void>`

- [ ] **Step 1: Write failing category test**

In `src/news/news-group-store.test.ts` or existing category tests if present, assert:

```ts
assert.equal(resolveNewsGroupCategory('public-events')?.key, 'public-events');
assert.equal(resolveNewsGroupCategory('actividades-publicas')?.key, 'public-events');
assert.equal(resolveNewsGroupCategory('public-events')?.defaultSubscribed, false);
```

- [ ] **Step 2: Verify category test fails**

Run: `node --import tsx --test src/news/news-group-store.test.ts`

Expected: FAIL because `public-events` is unknown.

- [ ] **Step 3: Write failing snapshot test**

In `src/telegram/schedule-flow.test.ts`, add a test around calendar broadcast side effects that creates one public and one private schedule event, subscribes one target to `events` and another to `public-events`, then asserts:

```ts
assert.match(internalMessage, /Evento público/);
assert.match(internalMessage, /Evento privado/);
assert.match(publicMessage, /Evento público/);
assert.doesNotMatch(publicMessage, /Evento privado/);
```

Also assert the stored snapshot keys include both `events` and `public-events`.

- [ ] **Step 4: Verify snapshot test fails**

Run: `node --import tsx --test src/telegram/schedule-flow.test.ts`

Expected: FAIL because no public category or filtered publication exists.

- [ ] **Step 5: Implement category and filtered entries**

In `src/news/news-group-catalog.ts`, extend `NewsGroupCategoryKey` with `'public-events'`, add the descriptor with aliases from the spec, and export:

```ts
export const publicEventsNewsGroupCategory = 'public-events' as const;
```

In `src/telegram/calendar-summary.ts`, add `isPublic` to schedule `CalendarEntry` and support:

```ts
publicOnly?: boolean;
```

Filter `scheduleEvents` before mapping when `publicOnly === true`.

- [ ] **Step 6: Implement public snapshot publication**

In `src/telegram/schedule-notifications.ts`, keep `publishCalendarSnapshotToNewsGroups` for `events`, and add shared helper parameters:

```ts
categoryKey: string;
publicOnly?: boolean;
titleText: string;
emptyText: string;
```

Expose this wrapper:

```ts
export async function publishPublicCalendarSnapshotToNewsGroups(
  input: PublishCalendarSnapshotInput,
): Promise<void> {
  return publishCalendarSnapshotForCategory({
    change: input.change,
    sendGroupMessage: input.sendGroupMessage,
    deleteMessage: input.deleteMessage,
    editMessageText: input.editMessageText,
    snapshotStorage: input.snapshotStorage,
    newsGroupRepository: input.newsGroupRepository,
    database: input.database,
    botLanguage: input.botLanguage,
    scheduleRepository: input.scheduleRepository,
    venueEventRepository: input.venueEventRepository,
    tableRepository: input.tableRepository,
    resolveActorDisplayName: input.resolveActorDisplayName,
    categoryKey: publicEventsNewsGroupCategory,
    publicOnly: true,
  });
}
```

Update snapshot key builder to include category:

```ts
function buildCalendarSnapshotMessageKey(categoryKey: string, chatId: number, messageThreadId: number | null): string {
  return `telegram.schedule.calendar_snapshot:${categoryKey}:${chatId}:${messageThreadId ?? 0}`;
}
```

Preserve fallback reading of old `telegram.schedule.calendar_snapshot:<chatId>:<topic>` keys for `events` only if needed to avoid leaving one stale old snapshot.

- [ ] **Step 7: Wire save side effects**

In `src/telegram/schedule-flow-support.ts`, update `runAfterScheduleSaveSideEffects` to call both internal and public snapshot publishers with the same dependencies.

- [ ] **Step 8: Verify Task 2 tests pass**

Run:

```bash
node --import tsx --test src/news/news-group-store.test.ts
node --import tsx --test src/telegram/schedule-flow.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

```bash
git add src/news/news-group-catalog.ts src/telegram/calendar-summary.ts src/telegram/schedule-notifications.ts src/telegram/schedule-flow-support.ts src/news/news-group-store.test.ts src/telegram/schedule-flow.test.ts src/telegram/calendar-flow.test.ts
git commit -m "feat: publish public schedule event snapshots"
```

### Task 3: Telegram Creation, Editing, And Public Access Gates

**Files:**
- Modify: `src/telegram/i18n-schedule.ts`
- Modify: `src/telegram/schedule-keyboards.ts`
- Modify: `src/telegram/schedule-draft-summary.ts`
- Modify: `src/telegram/schedule-presentation.ts`
- Modify: `src/telegram/schedule-flow-support.ts`
- Modify: `src/telegram/schedule-flow.test.ts`

**Interfaces:**
- Consumes: `ScheduleEventRecord.isPublic`
- Produces: public/private visibility labels in schedule summaries/details
- Produces: non-approved access to `schedule_event_<id>` and `schedule_details_<id>` only when `event.isPublic === true`

- [ ] **Step 1: Write failing creation UX tests**

In `src/telegram/schedule-flow.test.ts`, add tests for:

```ts
test('creation asks public visibility after open attendance mode', async () => {
  // Drive title/date/time/duration/open mode.
  assert.match(replies.at(-1)?.message ?? '', /actividad pública|activitat pública/i);
});

test('creation skips public visibility for closed activities', async () => {
  // Drive title/date/time/duration/closed mode.
  assert.doesNotMatch(replies.map((reply) => reply.message).join('\n'), /actividad pública|activitat pública/i);
  assert.equal(createdEvent?.isPublic, false);
});
```

- [ ] **Step 2: Verify creation UX tests fail**

Run: `node --import tsx --test src/telegram/schedule-flow.test.ts`

Expected: FAIL because no visibility step exists.

- [ ] **Step 3: Write failing public access tests**

In `src/telegram/schedule-flow.test.ts`, add:

```ts
test('non-approved users can open and join public schedule events', async () => {
  const context = createScheduleTestContext({ actor: pendingActor });
  repository.addEvent({ title: 'Evento público', attendanceMode: 'open', isPublic: true, lifecycleStatus: 'scheduled' });
  context.messageText = '/start schedule_event_4';

  assert.equal(await handleTelegramScheduleStartText(context), true);
  assert.match(replies.at(-1)?.message ?? '', /Evento público/);

  context.callbackData = 'schedule:join:4';
  assert.equal(await handleTelegramScheduleCallback(context), true);
  assert.equal(await repository.findParticipant(4, pendingActor.telegramUserId)?.status, 'active');
});

test('non-approved users cannot open private schedule events', async () => {
  const context = createScheduleTestContext({ actor: pendingActor });
  repository.addEvent({ title: 'Evento privado', attendanceMode: 'open', isPublic: false, lifecycleStatus: 'scheduled' });
  context.messageText = '/start schedule_event_5';

  assert.equal(await handleTelegramScheduleStartText(context), false);
});
```

- [ ] **Step 4: Verify public access tests fail**

Run: `node --import tsx --test src/telegram/schedule-flow.test.ts`

Expected: FAIL because the handler requires `actor.isApproved`.

- [ ] **Step 5: Implement copy and keyboards**

Add schedule i18n keys for Catalan, Spanish, and English:

```ts
askPublicVisibility
publicVisibilityYes
publicVisibilityNo
editFieldPublicVisibility
detailsVisibility
publicActivityTag
memberOnlyActivityTag
invalidPublicVisibility
```

Add keyboard builders:

```ts
buildPublicVisibilityOptions(language)
buildEditPublicVisibilityOptions(language)
```

Add `editFieldPublicVisibility` to edit menus only when `event.attendanceMode === 'open'`.

- [ ] **Step 6: Implement creation/edit flow**

In `handleCreateSession`, after `attendance-mode`:

- open: advance to `public-visibility`
- closed: set `isPublic: false` and continue to capacity

For `public-visibility`, parse yes/no, set `isPublic`, then ask capacity.

In `createScheduleEvent`, pass `isPublic: data.isPublic === true`.

In edit flow, add public visibility field for open events and pass `isPublic` to `updateScheduleEvent`.

Update `formatScheduleDraftSummary` and `formatScheduleEventDetails` to display visibility.

- [ ] **Step 7: Implement scoped public access gates**

In `handleTelegramScheduleStartText`, replace the top-level approved check with:

```ts
const canReadScheduleEvent = context.runtime.actor.isApproved || isPublicReadableEvent(event);
```

where `isPublicReadableEvent(event)` checks scheduled + open + public.

In `handleTelegramScheduleCallback`, allow non-approved actors only for `inspect`, `join`, and join reminder flow when the loaded event is public readable. Keep edit/cancel requiring approved actors.

- [ ] **Step 8: Verify Task 3 tests pass**

Run: `node --import tsx --test src/telegram/schedule-flow.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add src/telegram/i18n-schedule.ts src/telegram/schedule-keyboards.ts src/telegram/schedule-draft-summary.ts src/telegram/schedule-presentation.ts src/telegram/schedule-flow-support.ts src/telegram/schedule-flow.test.ts
git commit -m "feat: support public schedule event access"
```

### Task 4: Docs, Drift Fixes, And Full Validation

**Files:**
- Modify: `docs/feature-status.md`
- Modify: compile/test fixtures discovered by Task 1-3 validation

**Interfaces:**
- Consumes: completed feature from Tasks 1-3
- Produces: deployable bot with updated operational docs

- [ ] **Step 1: Update feature inventory**

In `docs/feature-status.md`, update:

- `Resumen ejecutivo` row for `Agenda de actividades`
- Agenda section to mention public open activities and public feed snapshots
- `/news` section to include `public-events`
- Access section to mention non-member participation only through public activity deep links

- [ ] **Step 2: Run focused tests**

Run:

```bash
node --import tsx --test src/schedule/schedule-catalog.test.ts
node --import tsx --test src/schedule/schedule-catalog-store.test.ts
node --import tsx --test src/news/news-group-store.test.ts
node --import tsx --test src/telegram/schedule-flow.test.ts
node --import tsx --test src/telegram/calendar-flow.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck and database checks**

Run:

```bash
npm run typecheck
npm run db:check
```

Expected: PASS.

- [ ] **Step 4: Run feature status audit**

Run: `./scripts/feature-status-audit.sh`

Expected: PASS or informational output with no required missing feature-status block.

- [ ] **Step 5: Deploy/restart local service**

Run: `./startup.sh`

Expected: completes successfully and restarts `gameclubtelegrambot.service`.

- [ ] **Step 6: Commit Task 4**

```bash
git add docs/feature-status.md
git add -u
git commit -m "docs: document public schedule events"
```

- [ ] **Step 7: Final status**

Run:

```bash
git status --short --branch
git log --oneline -5
```

Expected: working tree clean, branch ahead with implementation commits.
