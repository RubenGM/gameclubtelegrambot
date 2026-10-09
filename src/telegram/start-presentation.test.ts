import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStartPresentation, replyWithStartPresentation } from './start-presentation.js';

for (const language of ['ca', 'es', 'en'] as const) {
  test(`start presentation keeps summaries without the menu guide and escapes content (${language})`, () => {
    const input = { publicName: '<Club> & Friends', version: '1.2', language, isAdmin: false, isApproved: true, pendingMessage: 'Pending', summaries: ['<b>Today</b>\nGame &amp; friends', '<b>Notices</b>\n<a href="https://example.com">News</a>'] };
    const result = buildStartPresentation(input);
    assert.match(result.richHtml, /<h2>&lt;Club&gt; &amp; Friends<\/h2>/);
    assert.doesNotMatch(result.richHtml, /<table|Explora el club|Explore the club/);
    assert.doesNotMatch(result.message, /Explora el club|Explore the club/);
    assert.ok(!result.message.includes('1.2'));
    assert.match(result.richHtml, /<h3>Today<\/h3>/);
    assert.match(result.richHtml, /<a href="https:\/\/example.com">News<\/a>/);
    const admin = buildStartPresentation({ ...input, isAdmin: true });
    assert.match(admin.richHtml, /v1.2/);
    const pending = buildStartPresentation({ ...input, isApproved: false, pendingMessage: 'Access <required>', summaries: [] });
    assert.match(pending.richHtml, /Access &lt;required&gt;/);
    assert.ok(!pending.richHtml.includes('<table'));
  });
}

test('start sends rich privately with the same keyboard and complete fallback; groups keep ordinary replies', async () => {
  const options = { parseMode: 'HTML' as const, replyKeyboard: [['Catálogo']], persistentKeyboard: true };
  const start = { message: '<b>Club</b>\nWelcome', richHtml: '<h2>Club</h2><p>Welcome</p>', options };
  const replies: unknown[] = [];
  const rich: unknown[] = [];
  const context = { reply: async (...args: unknown[]) => { replies.push(args); }, runtime: { chat: { chatId: 42, kind: 'private' }, bot: { sendRichMessage: async (input: unknown) => { rich.push(input); } } } };
  await replyWithStartPresentation(context, start);
  assert.deepEqual(rich, [{ chatId: 42, richMessage: { html: start.richHtml }, fallbackText: start.message, options }]);
  assert.equal(replies.length, 0);
  await replyWithStartPresentation({ ...context, runtime: { ...context.runtime, bot: {} } }, start);
  context.runtime.chat.kind = 'group';
  await replyWithStartPresentation(context, start);
  assert.deepEqual(replies, [[start.message, options], [start.message, options]]);
  assert.equal(rich.length, 1);
});

test('start embeds a rich today table while preserving the separate HTML fallback and notice section', () => {
  const today = { message: '<b>Today</b>\n- Game', richHtml: '<h3>Today</h3><table compact><tr><td>Game</td></tr></table>' };
  const result = buildStartPresentation({ publicName: 'Club', version: '1', language: 'es', isAdmin: false,
    isApproved: true, pendingMessage: '', summaries: [today, '<b>Notices</b>\nNews'] });
  assert.ok(result.richHtml.includes(today.richHtml));
  assert.doesNotMatch(result.richHtml, /<p><table/);
  assert.match(result.richHtml, /<h3>Notices<\/h3><p>News<\/p>/);
  assert.ok(result.message.includes(today.message));
  assert.doesNotMatch(result.message, /<table|Explora el club/);
});
