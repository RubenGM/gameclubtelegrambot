import assert from 'node:assert/strict';
import test from 'node:test';

import { handleTelegramGoogleCalendarPublicLinkTrigger } from './google-calendar-public-link-flow.js';
import type { GoogleCalendarSettingsStore } from '../google-calendar/google-calendar-settings.js';

function context(overrides: Record<string, unknown> = {}) {
  const replies: Array<{ message: string; options: unknown }> = [];
  const deleted: Array<{ chatId: number; messageId: number }> = [];
  const settings: GoogleCalendarSettingsStore = {
    async getSettings() { return { calendarId: 'club@example.com', calendarUrl: 'https://calendar.google.test/club', visibility: 'private' as const, syncEnabled: true }; },
    async saveSettings() {},
  };
  return {
    replies, deleted,
    context: {
      messageText: '@cawa_management_bot calendar', messageId: 77, messageThreadId: 42,
      googleCalendarSettingsStore: settings,
      async reply(message: string, options?: unknown) { replies.push({ message, options }); },
      runtime: {
        chat: { kind: 'group-news', chatId: -100 },
        bot: { username: 'cawa_management_bot', async deleteMessage(input: { chatId: number; messageId: number }) { deleted.push(input); } },
        services: { database: { db: {} } },
        logger: { error() {} },
      },
      ...overrides,
    },
  };
}

test('group calendar trigger answers in the same topic and removes the trigger message', async () => {
  const fixture = context();
  assert.equal(await handleTelegramGoogleCalendarPublicLinkTrigger(fixture.context as never), true);
  assert.deepEqual(fixture.replies, [{
    message: 'Si quieres estar al día del calendario de actividades del club únete al Google Calendar: https://calendar.google.test/club',
    options: { messageThreadId: 42 },
  }]);
  assert.deepEqual(fixture.deleted, [{ chatId: -100, messageId: 77 }]);
});

test('group calendar trigger is strict and does not consume other mentions', async () => {
  const fixture = context({ messageText: '@cawa_management_bot calendar mañana' });
  assert.equal(await handleTelegramGoogleCalendarPublicLinkTrigger(fixture.context as never), false);
  assert.deepEqual(fixture.replies, []);
});

test('group calendar trigger keeps the answer when cleanup cannot delete the original message', async () => {
  const fixture = context();
  (fixture.context.runtime as { bot: { deleteMessage(input: { chatId: number; messageId: number }): Promise<void> } }).bot.deleteMessage = async () => { throw new Error('not enough rights'); };
  assert.equal(await handleTelegramGoogleCalendarPublicLinkTrigger(fixture.context as never), true);
  assert.equal(fixture.replies.length, 1);
});
