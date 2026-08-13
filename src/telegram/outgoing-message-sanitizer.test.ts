import test from 'node:test';
import assert from 'node:assert/strict';

import {
  splitTelegramOutgoingMessage,
  telegramCaptionTextLimit,
  telegramMessageTextLimit,
  truncateTelegramOutgoingCaption,
  truncateTelegramOutgoingMessage,
} from './outgoing-message-sanitizer.js';

test('splitTelegramOutgoingMessage splits plain text without breaking surrogate pairs', () => {
  const input = `inicio ${'a'.repeat(telegramMessageTextLimit)} 🦠 final`;
  const chunks = splitTelegramOutgoingMessage(input);

  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((chunk) => chunk.text.length <= telegramMessageTextLimit));
  assert.equal(chunks.map((chunk) => chunk.text).join(''), input);
  assert.ok(chunks.every((chunk) => chunk.changed));
});

test('splitTelegramOutgoingMessage closes and reopens HTML formatting across chunks', () => {
  const input = `<b>Pandemic ${'x'.repeat(telegramMessageTextLimit)}</b><i>final</i>`;
  const chunks = splitTelegramOutgoingMessage(input, 'HTML');

  assert.equal(chunks.length, 2);
  assert.match(chunks[0]!.text, /^<b>Pandemic /);
  assert.match(chunks[0]!.text, /<\/b>$/);
  assert.match(chunks[1]!.text, /^<b>/);
  assert.match(chunks[1]!.text, /<\/b><i>final<\/i>$/);
});

test('HTML entities count as one visible character', () => {
  const input = `<b>${'&amp;'.repeat(telegramMessageTextLimit)}</b>`;
  const chunks = splitTelegramOutgoingMessage(input, 'HTML');

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]!.text, input);
});

test('truncateTelegramOutgoingMessage preserves valid HTML and adds an ellipsis', () => {
  const result = truncateTelegramOutgoingMessage(`<b>${'x'.repeat(telegramMessageTextLimit + 20)}</b>`, 'HTML');

  assert.equal(result.changed, true);
  assert.match(result.text, /^<b>/);
  assert.match(result.text, /…<\/b>$/);
});

test('truncateTelegramOutgoingCaption removes unsupported control characters and respects its limit', () => {
  const result = truncateTelegramOutgoingCaption(`a\u0000${'b'.repeat(telegramCaptionTextLimit + 20)}`);

  assert.equal(result.changed, true);
  assert.ok(result.text.length <= telegramCaptionTextLimit);
  assert.doesNotMatch(result.text, /\u0000/);
  assert.match(result.text, /…$/);
});
