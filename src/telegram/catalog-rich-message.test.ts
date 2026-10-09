import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogRichMessage, replyWithCatalogRichMessage } from './catalog-rich-message.js';

test('catalog rich sections preserve multiline field HTML and the order of links, fields and results', () => {
  const rich = buildCatalogRichMessage('Catálogo <club>', '<a href="https://example.test/">Volver</a>\n<b>Descripción:</b> <i>Uno\nDos</i>\n\n- <a href="https://example.test/game">Juego &amp; Amigos</a>\n\nPágina 1/2');
  assert.match(rich.html ?? '', /<h2>Catálogo &lt;club&gt;<\/h2>/);
  assert.match(rich.html ?? '', /<p>.*Volver.*<\/p><table><tr><th>Descripción:<\/th><td><i>Uno\nDos<\/i><\/td><\/tr><\/table><ul><li>.*Juego &amp; Amigos.*<\/li><\/ul><p>Página 1\/2<\/p>/s);
});

test('catalog fallback retains the complete HTML and keyboard without rich capability', async () => {
  const calls: unknown[] = [];
  const text = `<b>Descripción:</b> ${'Información &amp; datos. '.repeat(300)}`;
  const options = { parseMode: 'HTML' as const, replyKeyboard: [['Inicio', 'Ayuda']] };
  await replyWithCatalogRichMessage({ reply: async (...args) => { calls.push(args); }, runtime: { bot: {}, chat: { chatId: 1 } } }, text, options);
  assert.deepEqual(calls, [[text, options]]);
});

test('catalog rich replies preserve topic, keyboard and full fallback', async () => {
  const options = { parseMode: 'HTML' as const, inlineKeyboard: [[{ text: 'Siguiente', callbackData: 'catalog:next' }]] };
  const text = '- <b>Juego &amp; Amigos</b>';
  let sent: unknown;
  await replyWithCatalogRichMessage({ reply: async () => { assert.fail('Unexpected fallback'); }, runtime: { bot: { language: 'es', sendRichMessage: async (input) => { sent = input; } }, chat: { chatId: -100, messageThreadId: 9 } } }, text, options);
  assert.deepEqual(sent, { chatId: -100, messageThreadId: 9, richMessage: buildCatalogRichMessage('Catálogo', text), fallbackText: text, options });
});
