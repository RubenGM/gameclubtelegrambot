import test from 'node:test';
import assert from 'node:assert/strict';
import { isTelegramRichMessageWithinLimits } from './rich-message-limits.js';

test('rich HTML limit counts visible decoded characters rather than tags, UTF-16 units or entities', () => {
  assert.equal(isTelegramRichMessageWithinLimits({ html: `<p>${'&amp;'.repeat(32_768)}</p>` }), true);
  assert.equal(isTelegramRichMessageWithinLimits({ html: `<p>${'&amp;'.repeat(32_769)}</p>` }), false);
  assert.equal(isTelegramRichMessageWithinLimits({ html: `<p>${'😀'.repeat(32_768)}</p>` }), true);
});

test('rich block, table width and nesting limits prevent oversized requests', () => {
  assert.equal(isTelegramRichMessageWithinLimits({ html: '<p>x</p>'.repeat(501) }), false);
  assert.equal(isTelegramRichMessageWithinLimits({ html: `<table><tr>${'<td>x</td>'.repeat(21)}</tr></table>` }), false);
  assert.equal(isTelegramRichMessageWithinLimits({ html: `${'<b>'.repeat(17)}x${'</b>'.repeat(17)}` }), false);
  assert.equal(isTelegramRichMessageWithinLimits({ blocks: Array.from({ length: 501 }, () => ({ type: 'paragraph', text: 'x' })) }), false);
  assert.equal(isTelegramRichMessageWithinLimits({ blocks: [{ type: 'table', cells: [Array.from({ length: 21 }, () => ({ text: 'x', align: 'left' as const, valign: 'top' as const }))] }] }), false);
});

test('rich structured content counts formula source and custom emoji alternative text', () => {
  assert.equal(isTelegramRichMessageWithinLimits({ blocks: [{ type: 'mathematical_expression', expression: 'x'.repeat(32_769) }] }), false);
  assert.equal(isTelegramRichMessageWithinLimits({ blocks: [{ type: 'paragraph', text: { type: 'custom_emoji', custom_emoji_id: '1', alternative_text: 'x'.repeat(32_769) } }] }), false);
});
