import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStartsAt, parseDate, parseTime, parseTimeHour } from './schedule-parsing.js';

test('buildStartsAt interprets schedule input as local time', () => {
  assert.equal(buildStartsAt('2026-04-27', '22:15'), new Date(2026, 3, 27, 22, 15, 0, 0).toISOString());
});

test('schedule dates reject impossible ISO and slash dates without normalizing them to another day', () => {
  for (const value of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-12', '31/04/2026', '29/02/2026']) {
    assert.ok(parseDate(value) instanceof Error, value);
  }
  assert.equal(parseDate('2028-02-29'), '2028-02-29');
  assert.equal(parseDate('29/02/2028'), '2028-02-29');
  assert.equal(parseDate('Viernes, 09/10/2026'), '2026-10-09');
});

test('schedule times accept clock boundaries and reject out-of-range hours and minutes', () => {
  assert.equal(parseTime('00:00'), '00:00');
  assert.equal(parseTime('23:59'), '23:59');
  assert.equal(parseTimeHour('0'), '00');
  assert.equal(parseTimeHour('23'), '23');
  for (const value of ['24:00', '25:00', '12:60', '99:99', '-1:00', '1:00']) assert.ok(parseTime(value) instanceof Error, value);
  for (const value of ['24', '99', '-1', '12:00']) assert.ok(parseTimeHour(value) instanceof Error, value);
});
