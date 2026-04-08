import test from 'node:test';
import assert from 'node:assert/strict';

import { createAppMetadataMembershipRequestNotificationSubscriptionStore, notifySubscribedAdminsOfMembershipRequest } from './request-notification-store.js';

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
      async updateUserStatus() {
        throw new Error('not used');
      },
      async appendStatusAuditLog() {
        throw new Error('not used');
      },
      async appendAuditEvent() {
        throw new Error('not used');
      },
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
      message: 'Nova sollicitud d accés de New Member (@new_member).',
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
