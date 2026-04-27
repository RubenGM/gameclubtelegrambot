import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAppMetadataMembershipRequestNotificationSubscriptionStore,
  notifyApprovedAdminsOfMembershipRevocation,
  notifySubscribedAdminsOfMembershipRequest,
} from './request-notification-store.js';

function createMemoryStorage() {
  const entries = new Map<string, string>();

  return {
    async get(key: string) {
      return entries.get(key) ?? null;
    },
    async set(key: string, value: string) {
      entries.set(key, value);
    },
    async delete(key: string) {
      return entries.delete(key);
    },
    async listByPrefix(prefix: string) {
      return Array.from(entries.entries())
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, value }));
    },
  };
}

test('notifySubscribedAdminsOfMembershipRequest sends localized private messages to approved admins only', async () => {
  const storage = createMemoryStorage();
  const store = createAppMetadataMembershipRequestNotificationSubscriptionStore({ storage });
  await store.setSubscribed(10, true);
  await store.setSubscribed(11, true);
  await store.setSubscribed(12, true);

  const users = new Map([
    [10, { telegramUserId: 10, displayName: 'Admin CA', status: 'approved', isAdmin: true }],
    [11, { telegramUserId: 11, displayName: 'Admin ES', status: 'approved', isAdmin: true }],
    [12, { telegramUserId: 12, displayName: 'Not Admin', status: 'approved', isAdmin: false }],
  ]);

  const messages: Array<{ telegramUserId: number; message: string; options?: { inlineKeyboard?: Array<Array<{ text: string; callbackData: string }>> } }> = [];

  const sentCount = await notifySubscribedAdminsOfMembershipRequest({
    store,
    membershipRepository: {
      async findUserByTelegramUserId(telegramUserId) {
        return (users.get(telegramUserId) as never) ?? null;
      },
      async syncUserProfile() {
        return null;
      },
      async backfillDisplayNames() {
        return 0;
      },
      async upsertPendingUser() {
        throw new Error('not used');
      },
      async listPendingUsers() {
        return [];
      },
      async listRevocableUsers() {
        return [];
      },
      async listApprovedAdminUsers() {
        return Array.from(users.values()).filter((user) => user.isAdmin) as never;
      },
      async findLatestRevocation() {
        return null;
      },
      async approveMembershipRequest() {
        throw new Error('not used');
      },
      async rejectMembershipRequest() {
        throw new Error('not used');
      },
      async revokeMembershipAccess() {
        throw new Error('not used');
      },
      async appendStatusAuditLog() { throw new Error('not used'); },
    },
    languagePreferenceReader: {
      async loadLanguage(telegramUserId) {
        if (telegramUserId === 11) {
          return 'es';
        }

        return 'ca';
      },
    },
    privateMessageSender: {
      async sendPrivateMessage(telegramUserId, message, options) {
        messages.push({ telegramUserId, message, ...(options ? { options } : {}) });
      },
    },
    requesterTelegramUserId: 42,
    requesterDisplayName: 'New Member',
    requesterUsername: 'new_member',
  });

  assert.equal(sentCount, 2);
  assert.deepEqual(messages, [
    {
      telegramUserId: 10,
      message: "Nova sol·licitud d'accés de New Member (@new_member).",
      options: {
        inlineKeyboard: [[{ text: 'Aprovar', callbackData: 'approve_access:42' }]],
      },
    },
    {
      telegramUserId: 11,
      message: 'Nueva solicitud de acceso de New Member (@new_member).',
      options: {
        inlineKeyboard: [[{ text: 'Aprobar', callbackData: 'approve_access:42' }]],
      },
    },
  ]);
});

test('notifySubscribedAdminsOfMembershipRequest includes prior revocation context when present', async () => {
  const storage = createMemoryStorage();
  const store = createAppMetadataMembershipRequestNotificationSubscriptionStore({ storage });
  await store.setSubscribed(10, true);

  const messages: Array<{ telegramUserId: number; message: string }> = [];

  await notifySubscribedAdminsOfMembershipRequest({
    store,
    membershipRepository: {
      async findUserByTelegramUserId() {
        return { telegramUserId: 10, displayName: 'Admin CA', status: 'approved', isAdmin: true } as never;
      },
      async syncUserProfile() { return null; },
      async backfillDisplayNames() { return 0; },
      async upsertPendingUser() { throw new Error('not used'); },
      async listPendingUsers() { return []; },
      async listRevocableUsers() { return []; },
      async listApprovedAdminUsers() { return []; },
      async findLatestRevocation() { return null; },
      async approveMembershipRequest() { throw new Error('not used'); },
      async rejectMembershipRequest() { throw new Error('not used'); },
      async revokeMembershipAccess() { throw new Error('not used'); },
      async appendStatusAuditLog() { throw new Error('not used'); },
    },
    languagePreferenceReader: {
      async loadLanguage() {
        return 'es';
      },
    },
    privateMessageSender: {
      async sendPrivateMessage(telegramUserId, message) {
        messages.push({ telegramUserId, message });
      },
    },
    requesterTelegramUserId: 42,
    requesterDisplayName: 'New Member',
    requesterUsername: 'new_member',
    priorRevocation: {
      changedByTelegramUserId: 99,
      createdAt: '2026-04-19T10:00:00.000Z',
      reason: 'Incumplio las normas',
    },
  });

  assert.equal(messages.length, 1);
  assert.match(messages[0]!.message, /Nueva solicitud de acceso de New Member/);
  assert.match(messages[0]!.message, /ya fue expulsado el 2026-04-19/);
  assert.match(messages[0]!.message, /Incumplio las normas/);
});

test('notifyApprovedAdminsOfMembershipRevocation alerts all approved admins with the reason', async () => {
  const messages: Array<{ telegramUserId: number; message: string }> = [];

  const sentCount = await notifyApprovedAdminsOfMembershipRevocation({
    membershipRepository: {
      async findUserByTelegramUserId() { return null; },
      async syncUserProfile() { return null; },
      async backfillDisplayNames() { return 0; },
      async upsertPendingUser() { throw new Error('not used'); },
      async listPendingUsers() { return []; },
      async listRevocableUsers() { return []; },
      async listApprovedAdminUsers() {
        return [
          { telegramUserId: 10, displayName: 'Admin Uno', status: 'approved', isAdmin: true },
          { telegramUserId: 11, displayName: 'Admin Dos', status: 'approved', isAdmin: true },
        ] as never;
      },
      async findLatestRevocation() { return null; },
      async appendStatusAuditLog() { throw new Error('not used'); },
      async approveMembershipRequest() { throw new Error('not used'); },
      async rejectMembershipRequest() { throw new Error('not used'); },
      async revokeMembershipAccess() { throw new Error('not used'); },
    },
    languagePreferenceReader: {
      async loadLanguage(telegramUserId) {
        return telegramUserId === 11 ? 'en' : 'ca';
      },
    },
    privateMessageSender: {
      async sendPrivateMessage(telegramUserId, message) {
        messages.push({ telegramUserId, message });
      },
    },
    revokedUser: {
      telegramUserId: 42,
      displayName: 'Usuari Expulsat',
      username: 'expulsat',
    },
    revokedBy: {
      telegramUserId: 99,
      displayName: 'Admin Responsable',
      username: 'admin',
    },
    reason: 'Conducta inapropiada',
  });

  assert.equal(sentCount, 2);
  assert.match(messages[0]!.message, /Motiu: Conducta inapropiada/);
  assert.match(messages[1]!.message, /Reason: Conducta inapropiada/);
});
