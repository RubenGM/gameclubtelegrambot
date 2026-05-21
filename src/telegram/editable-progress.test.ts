import test from 'node:test';
import assert from 'node:assert/strict';

import { extractTelegramReplyMessageId, resumeTelegramEditableProgress, startTelegramEditableProgress } from './editable-progress.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

test('startTelegramEditableProgress edits the initial message for updates and completion', async () => {
  const replies: Array<{ message: string; options: TelegramReplyOptions | undefined }> = [];
  const edits: Array<{ chatId: number; messageId: number; text: string; options?: TelegramReplyOptions }> = [];
  const context = {
    async reply(message: string, options?: TelegramReplyOptions) {
      replies.push({ message, options });
      return { message_id: 55 };
    },
    runtime: {
      chat: { chatId: 100 },
      bot: {
        async editMessageText(input: { chatId: number; messageId: number; text: string; options?: TelegramReplyOptions }) {
          edits.push(input);
        },
      },
    },
  };

  const progress = await startTelegramEditableProgress(context, 'Paso 1', {
    editFailedEvent: 'test.progress-edit.failed',
  });
  assert.equal(progress.messageId, 55);
  const updated = await progress.update('Paso 2');
  await progress.complete('Final', { parseMode: 'HTML' });

  assert.equal(updated, true);
  assert.deepEqual(replies, [{ message: 'Paso 1', options: undefined }]);
  assert.deepEqual(edits, [
    { chatId: 100, messageId: 55, text: 'Paso 2' },
    { chatId: 100, messageId: 55, text: 'Final', options: { parseMode: 'HTML' } },
  ]);
});

test('resumeTelegramEditableProgress edits an existing message without sending a new initial reply', async () => {
  const replies: Array<{ message: string; options: TelegramReplyOptions | undefined }> = [];
  const edits: Array<{ chatId: number; messageId: number; text: string; options?: TelegramReplyOptions }> = [];
  const context = {
    async reply(message: string, options?: TelegramReplyOptions) {
      replies.push({ message, options });
      return { message_id: 56 };
    },
    runtime: {
      chat: { chatId: 100 },
      bot: {
        async editMessageText(input: { chatId: number; messageId: number; text: string; options?: TelegramReplyOptions }) {
          edits.push(input);
        },
      },
    },
  };

  const progress = resumeTelegramEditableProgress(context, 55, {
    editFailedEvent: 'test.progress-edit.failed',
  });
  const updated = await progress.update('Paso actualizado', { parseMode: 'HTML' });

  assert.equal(progress.messageId, 55);
  assert.equal(updated, true);
  assert.deepEqual(replies, []);
  assert.deepEqual(edits, [
    { chatId: 100, messageId: 55, text: 'Paso actualizado', options: { parseMode: 'HTML' } },
  ]);
});

test('startTelegramEditableProgress falls back to a normal final reply when editing is unavailable', async () => {
  const replies: Array<{ message: string; options: TelegramReplyOptions | undefined }> = [];
  const context = {
    async reply(message: string, options?: TelegramReplyOptions) {
      replies.push({ message, options });
      return { message_id: 55 };
    },
    runtime: {
      chat: { chatId: 100 },
      bot: {},
    },
  };

  const progress = await startTelegramEditableProgress(context, 'Paso 1', {
    editFailedEvent: 'test.progress-edit.failed',
  });
  const updated = await progress.update('Paso 2');
  await progress.complete('Final', { parseMode: 'HTML' });

  assert.equal(updated, false);
  assert.deepEqual(replies, [
    { message: 'Paso 1', options: undefined },
    { message: 'Final', options: { parseMode: 'HTML' } },
  ]);
});

test('startTelegramEditableProgress can send the initial progress message with reply options', async () => {
  const replies: Array<{ message: string; options: TelegramReplyOptions | undefined }> = [];
  const context = {
    async reply(message: string, options?: TelegramReplyOptions) {
      replies.push({ message, options });
      return { message_id: 55 };
    },
    runtime: {
      chat: { chatId: 100 },
      bot: {},
    },
  };

  await startTelegramEditableProgress(
    context,
    'Paso 1',
    { editFailedEvent: 'test.progress-edit.failed' },
    { replyKeyboard: [['/cancel']] },
  );

  assert.deepEqual(replies, [
    { message: 'Paso 1', options: { replyKeyboard: [['/cancel']] } },
  ]);
});

test('startTelegramEditableProgress disables editing after the first edit failure', async () => {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  const replies: Array<{ message: string; options: TelegramReplyOptions | undefined }> = [];
  let editAttempts = 0;
  console.warn = (message?: unknown) => {
    warnings.push(String(message));
  };
  try {
    const context = {
      async reply(message: string, options?: TelegramReplyOptions) {
        replies.push({ message, options });
        return { message_id: 55 };
      },
      runtime: {
        chat: { chatId: 100 },
        bot: {
          async editMessageText() {
            editAttempts += 1;
            throw new Error('message is not modified');
          },
        },
      },
    };

    const progress = await startTelegramEditableProgress(context, 'Paso 1', {
      editFailedEvent: 'test.progress-edit.failed',
    });
    const updated = await progress.update('Paso 2');
    await progress.complete('Final');

    assert.equal(updated, false);
    assert.equal(editAttempts, 1);
    assert.deepEqual(replies, [
      { message: 'Paso 1', options: undefined },
      { message: 'Final', options: undefined },
    ]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /test\.progress-edit\.failed/);
    assert.match(warnings[0] ?? '', /message is not modified/);
  } finally {
    console.warn = originalWarn;
  }
});

test('extractTelegramReplyMessageId supports Telegram and internal message id spellings', () => {
  assert.equal(extractTelegramReplyMessageId({ message_id: 10 }), 10);
  assert.equal(extractTelegramReplyMessageId({ messageId: 11 }), 11);
  assert.equal(extractTelegramReplyMessageId({ message_id: 10.5 }), null);
  assert.equal(extractTelegramReplyMessageId({}), null);
  assert.equal(extractTelegramReplyMessageId(null), null);
});
