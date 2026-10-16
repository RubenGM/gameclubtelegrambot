import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppMetadataScheduleCleaningSettingsStore, defaultScheduleCleaningSettings } from './schedule-cleaning-settings.js';

test('schedule cleaning settings default to Friday morning and persist valid updates', async () => {
  const values = new Map<string, string>();
  const storage = {
    async get(key: string) { return values.get(key) ?? null; },
    async set(key: string, value: string) { values.set(key, value); },
    async delete(key: string) { return values.delete(key); },
    async listByPrefix() { return []; },
  };
  const store = createAppMetadataScheduleCleaningSettingsStore({ storage });
  assert.deepEqual(await store.get(), defaultScheduleCleaningSettings);
  await store.set({ weekday: 1, startsAt: '14:00', endsAt: '16:30' });
  assert.deepEqual(await store.get(), { weekday: 1, startsAt: '14:00', endsAt: '16:30' });
  await store.set(defaultScheduleCleaningSettings);
  assert.deepEqual(await store.get(), defaultScheduleCleaningSettings);
});

test('schedule cleaning settings reject invalid days and time ranges', async () => {
  const store = createAppMetadataScheduleCleaningSettingsStore({ storage: {
    async get() { return null; }, async set() {}, async delete() { return false; }, async listByPrefix() { return []; },
  } });
  await assert.rejects(store.set({ weekday: 7, startsAt: '09:00', endsAt: '12:00' }));
  await assert.rejects(store.set({ weekday: 5, startsAt: '12:00', endsAt: '09:00' }));
  await assert.rejects(store.set({ weekday: 5, startsAt: '09:60', endsAt: '12:00' }));
});
