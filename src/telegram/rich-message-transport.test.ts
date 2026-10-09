import test from 'node:test';
import assert from 'node:assert/strict';
import type { Api } from 'grammy';
import { createTelegramRichMessageTransport, isUnsupportedTelegramFeatureError, resolveMessageGenerationStopped } from './rich-message-transport.js';

function setup(messageIds?: number[]) {
  const calls: Array<{ method: string; input: Record<string, unknown> }> = [];
  const errors = new Map<string, unknown>();
  const api = Object.fromEntries(['sendRichMessage', 'editMessageText', 'sendMessageDraft', 'sendRichMessageDraft'].map((method) => [method, async (input: Record<string, unknown>) => {
    calls.push({ method, input });
    if (errors.has(method)) throw errors.get(method);
    return method.includes('Draft') ? true : { message_id: 42 };
  }])) as unknown as Api['raw'];
  const unsupported: string[] = [];
  const transport = createTelegramRichMessageTransport({
    api,
    call: async (_method, action) => action(),
    replyOptions: (options) => options ? {
      ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
      ...(options.messageThreadId ? { message_thread_id: options.messageThreadId } : {}),
      ...(options.inlineKeyboard ? { reply_markup: { inline_keyboard: options.inlineKeyboard } } : {}),
      ...(options.replyKeyboard ? { reply_markup: { keyboard: options.replyKeyboard } } : {}),
    } : undefined,
    sanitizeDraft: (text) => text.slice(0, 4096),
    async sendFallback(input) { calls.push({ method: 'fallback', input }); return { messageId: 43, ...(messageIds ? { messageIds } : {}) }; },
    async editFallback(input) { calls.push({ method: 'editFallback', input }); },
    onUnsupported: (operation) => { unsupported.push(operation); },
  });
  return { transport, calls, errors, unsupported };
}

test('rich sends use official rich_message payload, return ID and preserve thread and controls', async () => {
  const { transport, calls } = setup();
  const richMessage = { blocks: [{ type: 'heading' as const, size: 2 as const, text: 'Catálogo' }] };
  assert.deepEqual(await transport.sendRichMessage({ chatId: 7, richMessage, fallbackText: 'Catálogo', messageThreadId: 3, options: { parseMode: 'HTML', replyKeyboard: [['Inicio']] } }), { messageId: 42 });
  assert.deepEqual(calls, [{ method: 'sendRichMessage', input: { chat_id: 7, rich_message: richMessage, message_thread_id: 3, reply_markup: { keyboard: [['Inicio']] } } }]);
});

test('unsupported rich falls back preserving full text and keyboard and avoids repeated probes', async () => {
  const { transport, calls, errors, unsupported } = setup([41, 42, 43]);
  errors.set('sendRichMessage', { error_code: 404, description: 'Not Found: unknown method' });
  const input = { chatId: 7, richMessage: { html: '<h2>Catálogo</h2>' }, fallbackText: '<b>Catálogo</b>', messageThreadId: 3, options: { parseMode: 'HTML' as const, replyKeyboard: [['Inicio']] } };
  assert.deepEqual(await transport.sendRichMessage(input), { messageId: 43, messageIds: [41, 42, 43] });
  await transport.sendRichMessage(input);
  assert.equal(calls.filter((call) => call.method === 'sendRichMessage').length, 1);
  assert.deepEqual(calls[1]?.input, { chatId: 7, text: '<b>Catálogo</b>', options: { parseMode: 'HTML', replyKeyboard: [['Inicio']], messageThreadId: 3 } });
  assert.deepEqual(unsupported, ['sendRichMessage']);
});

test('rich editing uses editMessageText rich_message and excludes reply keyboard and thread', async () => {
  const { transport, calls, errors } = setup();
  const input = { chatId: 7, messageId: 42, richMessage: { html: '<p>Final</p>' }, fallbackText: 'Final', options: { replyKeyboard: [['Inicio']], messageThreadId: 3 } };
  await transport.editRichMessage(input);
  assert.deepEqual(calls[0]?.input, { chat_id: 7, message_id: 42, rich_message: { html: '<p>Final</p>' } });
  errors.set('editMessageText', { error_code: 400, description: 'Bad Request: rich messages are not supported' });
  await transport.editRichMessage(input);
  assert.deepEqual(calls.at(-1), { method: 'editFallback', input: { chatId: 7, messageId: 42, text: 'Final', options: {} } });
});

test('drafts preserve ID, topic, Stop flags and empty thinking placeholder', async () => {
  const { transport, calls } = setup();
  assert.equal(await transport.sendMessageDraft({ chatId: 7, draftId: 9, text: '', messageThreadId: 3, canStop: true, keepOnStop: false }), true);
  assert.deepEqual(calls[0]?.input, { chat_id: 7, draft_id: 9, text: '', message_thread_id: 3, can_stop: true, keep_on_stop: false });
  await assert.rejects(transport.sendMessageDraft({ chatId: 7, draftId: 0, text: 'Invalid' }), /non-zero/);
  assert.equal(calls.length, 1);
});

test('old text-only editing servers fall back without treating unrelated bad requests as unsupported', async () => {
  const { transport, calls, errors } = setup();
  const error = { error_code: 400, description: 'Bad Request: message text is empty' };
  errors.set('editMessageText', error);
  await transport.editRichMessage({ chatId: 7, messageId: 42, richMessage: { html: '<p>Final</p>' }, fallbackText: 'Final' });
  assert.equal(calls.at(-1)?.method, 'editFallback');
  assert.equal(isUnsupportedTelegramFeatureError(error), false);
});

test('unsupported rich draft degrades to plain draft then reports unsupported for editable fallback', async () => {
  const { transport, calls, errors } = setup();
  errors.set('sendRichMessageDraft', { error_code: 404, description: 'Not Found: unknown method' });
  const input = { chatId: 7, draftId: 9, richMessage: { html: '<p>Texto</p>' }, fallbackText: 'Texto', messageThreadId: 3, canStop: true };
  assert.equal(await transport.sendRichMessageDraft(input), true);
  assert.deepEqual(calls.map((call) => call.method), ['sendRichMessageDraft', 'sendMessageDraft']);
  assert.deepEqual(calls[1]?.input, { chat_id: 7, draft_id: 9, text: 'Texto', message_thread_id: 3, can_stop: true });
  errors.set('sendMessageDraft', { error_code: 400, description: 'Bad Request: message drafts are not supported' });
  assert.equal(await transport.sendRichMessageDraft(input), false);
  assert.equal(calls.some((call) => call.method === 'fallback'), false);
});

test('authorization, rate limit, network and malformed rich errors are propagated without fallback', async () => {
  for (const error of [{ error_code: 401, description: 'Unauthorized' }, { error_code: 403, description: 'Forbidden' }, { error_code: 429, description: 'Too Many Requests' }, new Error('fetch failed'), { error_code: 400, description: 'Bad Request: cannot parse rich_message' }]) {
    const { transport, calls, errors } = setup();
    errors.set('sendRichMessage', error);
    await assert.rejects(transport.sendRichMessage({ chatId: 7, richMessage: { html: '<p>Text</p>' }, fallbackText: 'Text' }), (actual) => actual === error);
    assert.deepEqual(calls.map((call) => call.method), ['sendRichMessage']);
    assert.equal(isUnsupportedTelegramFeatureError(error), false);
  }
});

test('rich contract rejects empty or ambiguous formats before network request', async () => {
  const { transport, calls } = setup();
  for (const richMessage of [{}, { html: '<p>Text</p>', markdown: 'Text' }]) {
    await assert.rejects(transport.sendRichMessage({ chatId: 7, richMessage, fallbackText: 'Text' }), /exactly one/);
  }
  assert.deepEqual(calls, []);
});

test('native Stop resolves private user from chat without an invented from/user field', () => {
  assert.deepEqual(resolveMessageGenerationStopped({ stopped_message_generation: { chat: { id: 7, type: 'private' }, draft_id: 9, message_thread_id: 3 } }), { chatId: 7, userId: 7, draftId: 9, messageThreadId: 3 });
  assert.equal(resolveMessageGenerationStopped({ stopped_message_generation: { chat: { id: -7, type: 'supergroup' }, draft_id: 9 } }), undefined);
  assert.equal(resolveMessageGenerationStopped({ stopped_message_generation: { chat: { id: 7, type: 'private' }, draft_id: 0 } }), undefined);
});

test('oversized rich content preserves full durable fallback and caps ephemeral plain drafts', async () => {
  const { transport, calls } = setup();
  const fallbackText = 'a'.repeat(32_769);
  const richMessage = { html: `<p>${fallbackText}</p>` };
  await transport.sendRichMessage({ chatId: 7, richMessage, fallbackText });
  assert.deepEqual(calls[0], { method: 'fallback', input: { chatId: 7, text: fallbackText } });
  await transport.sendRichMessageDraft({ chatId: 7, draftId: 9, richMessage, fallbackText });
  assert.equal(calls.at(-1)?.method, 'sendMessageDraft');
  assert.equal(String(calls.at(-1)?.input.text).length, 4096);
  assert.equal(calls.some((call) => call.method === 'sendRichMessage' || call.method === 'sendRichMessageDraft'), false);
});
