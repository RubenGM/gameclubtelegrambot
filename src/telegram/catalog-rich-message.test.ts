import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogRichDetailMessage, buildCatalogRichMessage, replyWithCatalogRichMessage } from './catalog-rich-message.js';
import { createTelegramI18n, supportedBotLanguages } from './i18n.js';
import { escapeHtml, formatHtmlField } from './catalog-presentation.js';

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

for (const language of supportedBotLanguages) {
  test(`catalog item hierarchy retains borrower, owner, metadata and multiline description in ${language}`, () => {
    const { catalogAdmin: admin, catalogLoan: loan } = createTelegramI18n(language);
    const html = buildCatalogRichDetailMessage('Juego <Club>', [
      '<a href="https://example.test/back">Volver</a>',
      '<b>Juego &lt;Club&gt;</b>',
      formatHtmlField(admin.owner, '<a href="tg://user?id=7">Ana &amp; Leo</a>'),
      formatHtmlField(admin.storagePosition, 'A&amp;1'),
      formatHtmlField(loan.availabilityAvailable, loan.availabilityLoaned),
      formatHtmlField(loan.availabilityHas, 'María &lt;Club&gt;'),
      formatHtmlField(admin.players, '2-4'),
      formatHtmlField(admin.playTimeMinutes, '45 min'),
      formatHtmlField(admin.recommendedAge, '10+'),
      formatHtmlField(admin.description, '<i>Primera\nSegunda &amp; tercera</i>'),
      '<b>Extra:</b> Valor',
      '<a href="https://example.test/full">Más detalles</a>',
    ].join('\n'), language).html!;
    assert.match(html, /^<h2>Juego &lt;Club&gt;<\/h2><p><a[^>]+>Volver<\/a><\/p><table>/);
    assert.equal((html.match(/<table>/g) ?? []).length, 1);
    assert.doesNotMatch(html, /<table compact>|👥|⏱/);
    assert.ok(html.includes(`<mark>${escapeHtml(loan.availabilityLoaned)}</mark>`));
    assert.ok(html.includes('María &lt;Club&gt;'));
    assert.ok(html.includes('<a href="tg://user?id=7">Ana &amp; Leo</a>'));
    assert.ok(html.includes(`<th>${escapeHtml(admin.description)}:</th><td><i>Primera\nSegunda &amp; tercera</i></td>`));
    assert.match(html, /<th>Extra:<\/th><td>Valor<\/td>/);
    assert.match(html, /<p><a href="https:\/\/example.test\/full">Más detalles<\/a><\/p>$/);
    assert.doesNotMatch(html, /<Club>/);
    assert.equal((html.match(/Juego &lt;Club&gt;/g) ?? []).length, 1);
  });
}

test('catalog detail without game metrics retains plain descriptions and does not mark available items as loaned', () => {
  const html = buildCatalogRichDetailMessage('Libro', '<b>Libro</b>\n<b>Disponibilidad:</b> Disponible\nDescripción: Uno &amp; dos\n<b>Editorial:</b> Club', 'es').html!;
  assert.match(html, /<td><b>Disponible<\/b><\/td>/);
  assert.match(html, /<th>Descripción:<\/th><td>Uno &amp; dos<\/td>/);
  assert.doesNotMatch(html, /👥|⏱|<mark>/);
});

test('catalog detail replies preserve receipts, admin IDs, fallback, topic and keyboard', async () => {
  const text = 'Préstamo registrado.\n\n<b>Juego</b> (#12)\n<b>Disponibilidad:</b> En préstamo';
  const options = { parseMode: 'HTML' as const, replyKeyboard: [['Inicio', 'Ayuda']] };
  let sent: import('./rich-message-transport.js').TelegramRichMessageInput | undefined;
  await replyWithCatalogRichMessage({ reply: async () => { assert.fail('Unexpected fallback'); }, runtime: { bot: { language: 'es', sendRichMessage: async (input) => { sent = input; } }, chat: { chatId: -100, messageThreadId: 9 } } }, text, options, 'Juego');
  assert.equal(sent?.fallbackText, text);
  assert.deepEqual(sent?.options, options);
  assert.equal(sent?.messageThreadId, 9);
  assert.match(sent?.richMessage.html ?? '', /^<h2>Juego<\/h2><p>Préstamo registrado.<\/p>/);
  assert.match(sent?.richMessage.html ?? '', /<th>ID:<\/th><td><code>#12<\/code><\/td>/);
});
