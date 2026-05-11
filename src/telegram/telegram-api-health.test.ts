import test from 'node:test';
import assert from 'node:assert/strict';

import { createTelegramApiHealthMonitor } from './telegram-api-health.js';

test('Telegram API health warning appears after a transient failure and recovers after quiet successes', () => {
  let now = new Date('2026-05-10T15:00:00.000Z');
  const monitor = createTelegramApiHealthMonitor({
    now: () => now,
    recoveryQuietMs: 60_000,
    successRecoveryCount: 2,
  });

  assert.equal(monitor.appendWarning('Hola'), 'Hola');

  monitor.recordFailure('sendMessage', new Error('timeout'));

  assert.equal(monitor.snapshot().degraded, true);
  assert.match(
    monitor.appendWarning('Hola'),
    /Problemas de conexión con Telegram detectados desde 2026-05-10 17:00:00/,
  );

  monitor.recordSuccess('sendMessage');
  now = new Date('2026-05-10T15:00:30.000Z');
  monitor.recordSuccess('sendMessage');
  assert.equal(monitor.snapshot().degraded, true);

  now = new Date('2026-05-10T15:01:01.000Z');
  assert.equal(monitor.snapshot().degraded, false);
  assert.equal(monitor.appendWarning('Hola'), 'Hola');
});

test('Telegram API health warning is skipped when it would exceed message length', () => {
  const monitor = createTelegramApiHealthMonitor({
    now: () => new Date('2026-05-10T15:00:00.000Z'),
    maxTextMessageLength: 20,
  });
  monitor.recordFailure('sendMessage', new Error('timeout'));

  assert.equal(monitor.appendWarning('12345678901234567890'), '12345678901234567890');
});
