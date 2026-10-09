import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScheduleResourceAvailabilityMessage } from './schedule-create-presentation.js';

test('resource availability escapes user resource names and retains every choice in rich and fallback views', () => {
  const message = buildScheduleResourceAvailabilityMessage({
    availability: { tables: [
      { id: 1, displayName: '<script>mesa & "uno"</script>', busy: true, conflictingEventIds: [23] },
      { id: 2, displayName: 'Mesa libre', busy: false, conflictingEventIds: [] },
    ], equipment: [] }, kind: 'tables', language: 'es', prompt: 'Elige una mesa.', intervalLabel: '9 oct · 18:00–20:00',
  });
  assert.match(message.richMessage.html ?? '', /&lt;script&gt;mesa &amp; &quot;uno&quot;&lt;\/script&gt;/);
  assert.doesNotMatch(message.richMessage.html ?? '', /<script>/);
  assert.match(message.richMessage.html ?? '', /🟠 Ocupado/);
  assert.match(message.richMessage.html ?? '', /Mesa libre<\/td><td>🟢 Libre/);
  assert.match(message.text, /&lt;script&gt;/);
  assert.match(message.text, /Los solapamientos habituales no bloquean/);
  assert.match(message.text, /Mesa libre/);
});

test('resource availability uses the same localized status and warning for equipment in all supported languages', () => {
  for (const [language, free, priority] of [['ca', 'Lliure', 'les reserves prioritàries sí'], ['es', 'Libre', 'las reservas prioritarias sí'], ['en', 'Free', 'priority reservations do']] as const) {
    const message = buildScheduleResourceAvailabilityMessage({
      availability: { tables: [], equipment: [{ id: 3, displayName: 'TV', busy: false, conflictingEventIds: [] }] },
      kind: 'equipment', language, prompt: 'TV', intervalLabel: '18:00–20:00',
    });
    assert.ok(message.text.includes(free));
    assert.ok(message.text.includes(priority));
    assert.ok(message.richMessage.html?.includes(free));
    assert.ok(message.richMessage.html?.includes(priority));
  }
});
