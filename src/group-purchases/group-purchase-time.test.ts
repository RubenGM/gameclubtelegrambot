import assert from 'node:assert/strict';
import test from 'node:test';
import { endOfGroupPurchaseDay, groupPurchaseDateParts } from './group-purchase-time.js';

test('purchase deadlines end on the requested Madrid day across winter, summer and DST changes', () => {
  for (const [date, utcHour] of [['2026-01-20', '22'], ['2026-06-30', '21'], ['2026-03-29', '21'], ['2026-10-25', '22']] as const) {
    const deadline = endOfGroupPurchaseDay(date);
    assert.equal(deadline, `${date}T${utcHour}:59:59.000Z`);
    const parts = groupPurchaseDateParts(deadline);
    assert.equal(`${parts.year}-${parts.month}-${parts.day}`, date);
    assert.equal(`${parts.hour}:${parts.minute}:${parts.second}`, '23:59:59');
  }
});

test('purchase dates and reminders use the Madrid day even when UTC is still on the previous day', () => {
  const parts = groupPurchaseDateParts('2026-10-22T23:59:00.000Z');
  assert.deepEqual(parts, { year: '2026', month: '10', day: '23', hour: '01', minute: '59', second: '00' });
});
