import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramI18n, type BotLanguage } from './i18n.js';
import { handleTelegramScheduleText, type TelegramScheduleContext } from './schedule-flow.js';
import { buildCreateConfirmOptions } from './schedule-keyboards.js';
import type { ConversationSessionRecord } from './conversation-session.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import type { ScheduleEventRecord, ScheduleRepository } from '../schedule/schedule-catalog.js';

const draft = {
  title: 'Catan', date: '2026-04-05', time: '16:00', durationMinutes: 150,
  attendanceMode: 'open', isPublic: true, capacity: 6, initialOccupiedSeats: 2,
  tableId: 7, equipmentIds: [3], catalogItemId: 25, description: 'Club & amics',
  detailsMessageChatId: 1, detailsMessageId: 41, detailsMessageHtml: '<b>Club &amp; amics</b>',
};

function fixture(language: BotLanguage, flowKey = 'schedule-create', stepKey = 'confirm', data: Record<string, unknown> = { ...draft }) {
  let session: ConversationSessionRecord | null = {
    key: 'test', flowKey, stepKey, data, createdAt: '', updatedAt: '', expiresAt: '',
  };
  const events: ScheduleEventRecord[] = [];
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const resources = { lifecycleStatus: 'active', createdAt: '', updatedAt: '', deactivatedAt: null, description: null } as const;
  const table = { ...resources, id: 7, displayName: 'Mesa TV', recommendedCapacity: 6 };
  const equipment = { ...resources, id: 3, displayName: 'Proyector' };
  const repository = {
    async createEvent(input: Parameters<ScheduleRepository['createEvent']>[0]) {
      const event: ScheduleEventRecord = {
        ...input, id: events.length + 1, createdAt: '', updatedAt: '', lifecycleStatus: 'scheduled',
        detailsMessageChatId: input.detailsMessageChatId ?? null, detailsMessageId: input.detailsMessageId ?? null,
        initialOccupiedSeats: input.initialOccupiedSeats ?? 0, equipmentIds: input.equipmentIds ?? [],
        cancelledAt: null, cancelledByTelegramUserId: null, cancellationReason: null,
      };
      events.push(event); return event;
    },
    async listEvents() { return events; },
    async findEventById(id: number) { return events.find((event) => event.id === id) ?? null; },
    async listParticipants() { return []; },
    async findParticipant() { return null; },
  } as unknown as ScheduleRepository;
  const context = {
    reply: async (message: string, options?: TelegramReplyOptions) => { replies.push({ message, ...(options ? { options } : {}) }); },
    runtime: {
      actor: { telegramUserId: 42, status: 'approved', isApproved: true, isBlocked: false, isAdmin: false, permissions: [] },
      authorization: { can: () => false, authorize: () => ({ allowed: false }) },
      chat: { kind: 'private', chatId: 1 }, services: { database: { db: undefined } },
      bot: { language, publicName: 'Club', clubName: 'Club', sendPrivateMessage: async () => {}, sendGroupMessage: async () => {} },
      session: {
        get current() { return session; },
        async start(input: { flowKey: string; stepKey: string; data?: Record<string, unknown> }) {
          session = { key: 'test', ...input, data: input.data ?? {}, createdAt: '', updatedAt: '', expiresAt: '' }; return session;
        },
        async advance(input: { stepKey: string; data: Record<string, unknown> }) {
          assert.ok(session); session = { ...session, ...input }; return session;
        },
        async cancel() { session = null; return true; },
      },
    },
    scheduleRepository: repository,
    tableRepository: { async listTables() { return [table]; }, async findTableById(id: number) { return id === 7 ? table : null; } },
    equipmentRepository: { async listEquipment() { return [equipment]; }, async findEquipmentById(id: number) { return id === 3 ? equipment : null; } },
    venueEventRepository: { async listVenueEvents() { return []; } },
    membershipRepository: { async findUserByTelegramUserId() { return { telegramUserId: 42, displayName: 'Ada', username: null, status: 'approved', isAdmin: false }; } },
    auditRepository: { async appendEvent() {} },
    newsGroupRepository: { async listSubscribedGroupsByCategory() { return []; }, async listGroups() { return []; } },
  } as unknown as TelegramScheduleContext;
  async function send(text: string) { context.messageText = text; assert.equal(await handleTelegramScheduleText(context), true); }
  return { context, send, events, replies, repository, get session() { return session; } };
}

test.beforeEach((t: any) => { t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-04-05T09:00:00.000Z') }); });

for (const language of ['ca', 'es', 'en'] as const) {
  test(`simple creation requires review and explicit save (${language})`, async () => {
    const f = fixture(language, 'schedule-create-simple', 'title', {});
    const texts = createTelegramI18n(language).schedule;
    for (const text of ['Cascadia', '05/04', '16', ':30', texts.attendanceOpen, '6']) await f.send(text);
    assert.equal(f.session?.stepKey, 'confirm');
    assert.equal(f.events.length, 0);
    assert.equal(f.session?.data.durationMinutes, 180);
    assert.equal(f.session?.data.isPublic, false);
    assert.equal(f.session?.data.initialOccupiedSeats, 0);
    assert.equal(f.session?.data.tableId, null);
    await f.send(texts.confirmCreate);
    assert.equal(f.events.length, 1);
    assert.equal(f.events[0]?.capacity, 6);
    assert.equal(f.session, null);
  });

  test(`summary edits every field and validates dependent values (${language})`, async () => {
    const f = fixture(language); const texts = createTelegramI18n(language).schedule;
    await f.send(texts.editFieldAttendanceMode); await f.send(texts.attendanceOpen);
    assert.equal(f.session?.data.isPublic, true); assert.equal(f.session?.data.initialOccupiedSeats, 2);
    for (const [label, value, property, expected] of [
      [texts.editFieldTitle, 'Catan & amics', 'title', 'Catan & amics'],
      [texts.editFieldDate, '06/04', 'date', '2026-04-06'],
      [texts.editFieldTime, '19:15', 'time', '19:15'],
      [texts.editFieldCapacity, '8', 'capacity', 8],
      [texts.editFieldPublicVisibility, texts.publicVisibilityNo, 'isPublic', false],
      [texts.editFieldInitialOccupiedSeats, '3', 'initialOccupiedSeats', 3],
    ] as const) {
      await f.send(label); await f.send(value);
      assert.equal(f.session?.stepKey, 'confirm'); assert.equal(f.session?.data[property], expected);
      assert.equal(f.session?.data.catalogItemId, 25); assert.deepEqual(f.session?.data.equipmentIds, [3]);
      assert.equal(f.session?.data.detailsMessageChatId, 1); assert.equal(f.session?.data.detailsMessageId, 41);
    }
    await f.send(texts.editFieldCapacity); await f.send('0');
    assert.equal(f.session?.stepKey, 'confirm-capacity'); assert.equal(f.session?.data.capacity, 8);
    await f.send('2'); assert.equal(f.session?.stepKey, 'confirm-capacity');
    assert.equal(f.session?.data.initialOccupiedSeats, 3); // A lower capacity cannot silently discard occupied seats.
    await f.send(texts.creationBack);
    await f.send(texts.editFieldInitialOccupiedSeats); await f.send('9');
    assert.equal(f.session?.stepKey, 'confirm-initial-occupied-seats');
    await f.send(texts.creationBack);
    await f.send(texts.editFieldTime); await f.send('25:00'); assert.equal(f.session?.stepKey, 'confirm-time');
    await f.send('20'); await f.send(':45'); assert.equal(f.session?.data.time, '20:45');
    await f.send(texts.editFieldDate); await f.send('31/02'); assert.equal(f.session?.stepKey, 'confirm-date');
    await f.send(texts.creationBack);
    await f.send(texts.editFieldAttendanceMode); await f.send(texts.attendanceOpen);
    assert.equal(f.session?.data.isPublic, false); assert.equal(f.session?.data.initialOccupiedSeats, 3);
    await f.send(texts.editFieldAttendanceMode); await f.send(texts.attendanceClosed);
    assert.equal(f.session?.data.isPublic, false); assert.equal(f.session?.data.initialOccupiedSeats, 0);
    const labels = buildCreateConfirmOptions(language, f.session?.data).replyKeyboard?.flat();
    assert.equal(labels?.includes(texts.editFieldPublicVisibility), false);
    assert.equal(labels?.includes(texts.editFieldInitialOccupiedSeats), false);
    await f.send(texts.editFieldPublicVisibility); assert.equal(f.session?.stepKey, 'confirm');
    await f.send(texts.editFieldDuration);
    const durationButtons = f.replies.at(-1)?.options?.replyKeyboard?.flat();
    assert.ok(durationButtons?.includes(texts.createDefaultDuration));
    assert.equal(durationButtons?.includes(texts.durationNone), false);
    await f.send(texts.createDefaultDuration); assert.equal(f.session?.data.durationMinutes, 120);
    await f.send(texts.editFieldDuration); await f.send(texts.durationHours); await f.send('0');
    assert.equal(f.session?.stepKey, 'confirm-duration-hours');
    await f.send(texts.creationBack); assert.equal(f.session?.stepKey, 'confirm-duration-mode');
    await f.send(texts.durationHoursMinutes); await f.send('02:30'); assert.equal(f.session?.data.durationMinutes, 150);
    await f.send(texts.editFieldTable); await f.send(texts.noTable);
    await f.send(texts.finishEquipment); assert.equal(f.session?.stepKey, 'confirm'); assert.equal(f.session?.data.tableId, null);
    await f.send(texts.editFieldEquipment); await f.send('✓ Proyector'); await f.send(texts.noEquipment);
    assert.deepEqual(f.session?.data.equipmentIds, []); assert.equal(f.session?.stepKey, 'confirm');
    await f.send(texts.editFieldDescription); await f.send('Nova descripció'); assert.equal(f.session?.data.description, 'Nova descripció');
    assert.equal(f.session?.data.catalogItemId, 25);
    assert.equal(f.events.length, 0);
  });

  test(`Back preserves the entire draft and Exit leaves creation (${language})`, async () => {
    const f = fixture(language); const texts = createTelegramI18n(language).schedule;
    for (let index = 0; index < 4; index++) {
      await f.send(texts.creationBack);
      assert.deepEqual(f.session?.data, draft);
    }
    assert.equal(f.session?.stepKey, 'title');
    await f.send('Títol actualitzat'); await f.send('06/04'); await f.send('17:00');
    assert.equal(f.session?.data.durationMinutes, 150); assert.equal(f.session?.data.tableId, 7);
    assert.equal(f.session?.data.isPublic, true); assert.equal(f.session?.data.initialOccupiedSeats, 2);
    assert.equal(f.session?.data.catalogItemId, 25); assert.deepEqual(f.session?.data.equipmentIds, [3]);
    assert.equal(f.session?.data.detailsMessageId, 41);
    await f.send(texts.exitCreation); assert.equal(f.session, null); assert.equal(f.events.length, 0);
  });
}

test('saving rechecks priority conflicts introduced after review', async () => {
  const f = fixture('es'); const texts = createTelegramI18n('es').schedule;
  // Another admin can reserve the interval after the user has already reached the summary.
  const priority = await f.repository.createEvent({ title: 'Asamblea', description: null, startsAt: '2026-04-05T14:00:00.000Z',
    durationMinutes: 180, attendanceMode: 'closed', isPublic: false, initialOccupiedSeats: 0,
    organizerTelegramUserId: 99, createdByTelegramUserId: 99, tableId: null, capacity: 20 });
  priority.isPriority = true;
  await f.send(texts.confirmCreate);
  assert.equal(f.events.length, 1);
  assert.match(f.replies.at(-1)?.message ?? '', /Asamblea/);
});
