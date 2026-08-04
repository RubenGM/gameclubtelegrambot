import test from 'node:test';
import assert from 'node:assert/strict';

import { formatScheduleDescriptionSummary, formatTimestamp, truncateScheduleDescription } from './schedule-presentation.js';

test('formatTimestamp displays schedule timestamps in local time', () => {
  const localInstant = new Date(2026, 3, 27, 22, 15, 0, 0).toISOString();

  assert.equal(formatTimestamp(localInstant), '27/04/2026 22:15');
});

test('truncateScheduleDescription limits summaries to 30 characters including ellipsis', () => {
  assert.equal(truncateScheduleDescription('123456789012345678901234567890'), '123456789012345678901234567890');
  assert.equal(truncateScheduleDescription('1234567890123456789012345678901'), '123456789012345678901234567...');
  assert.equal(Array.from(truncateScheduleDescription('🎲'.repeat(31))).length, 30);
});

test('formatScheduleDescriptionSummary links only shortened descriptions to the activity detail', () => {
  assert.equal(
    formatScheduleDescriptionSummary({ description: 'Descripción breve', eventId: 7, language: 'es' }),
    '<i>Descripción breve</i>',
  );
  assert.match(
    formatScheduleDescriptionSummary({ description: '1234567890123456789012345678901', eventId: 7, language: 'es' }),
    /^<i>123456789012345678901234567\.\.\.<\/i> · <a href=".+schedule_event_7">Ver descripción<\/a>$/,
  );
});
