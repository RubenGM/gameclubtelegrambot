import test from 'node:test';
import assert from 'node:assert/strict';
import { replyWithStorageRichMessage } from './storage-rich-presentation.js';
import type { TelegramRichMessageInput } from './rich-message-transport.js';

test('Storage rich fallback preserves long HTML and persistent navigation when the capability is absent', async () => {
  const calls: unknown[] = [];
  const text = `<b>Descripción:</b> ${'Contenido &amp; datos. '.repeat(400)}`;
  const options = { parseMode: 'HTML' as const, replyKeyboard: [['Inicio', 'Ayuda']], persistentKeyboard: true };
  await replyWithStorageRichMessage({ reply: async (...args) => { calls.push(args); }, runtime: { chat: { chatId: 1 }, bot: {} } }, text, options, '<table><tr><td>Contenido</td></tr></table>');
  assert.deepEqual(calls, [[text, options]]);
});

test('Storage rich replies keep topic, action keyboard and complete fallback text', async () => {
  const sent: TelegramRichMessageInput[] = [];
  const options = { parseMode: 'HTML' as const, inlineKeyboard: [[{ text: 'Volver', callbackData: 'storage:root' }]] };
  const fallback = '<b>Descripción:</b> Una ficha';
  await replyWithStorageRichMessage({ reply: async () => assert.fail('Unexpected fallback'), runtime: { chat: { chatId: -100, messageThreadId: 9 }, bot: { language: 'es', sendRichMessage: async (message) => { sent.push(message); } } } }, fallback, options, '<table><tr><td>Una ficha</td></tr></table>');
  assert.equal(sent[0]?.messageThreadId, 9);
  assert.deepEqual(sent[0]?.options, options);
  assert.equal(sent[0]?.fallbackText, fallback);
  assert.match(sent[0]?.richMessage.html ?? '', /<h2>.*<\/h2><table>/);
});

test('Storage generic previews keep multiline formatted fields balanced', async () => {
  const sent: TelegramRichMessageInput[] = [];
  await replyWithStorageRichMessage({ reply: async () => assert.fail('Unexpected fallback'), runtime: { chat: { chatId: 1 }, bot: { sendRichMessage: async (message) => { sent.push(message); } } } }, '<b>Descripción:</b> <i>Primera\nSegunda</i>\n<b>Tags:</b> <a href="https://example.test/tag">#tag</a>', { parseMode: 'HTML' });
  assert.match(sent[0]?.richMessage.html ?? '', /<td><i>Primera\nSegunda<\/i><\/td>/);
  assert.match(sent[0]?.richMessage.html ?? '', /<td><a href="https:\/\/example.test\/tag">#tag<\/a><\/td>/);
});
