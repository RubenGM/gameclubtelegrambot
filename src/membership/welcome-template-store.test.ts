import assert from 'node:assert/strict';
import test from 'node:test';

import type { AppMetadataSessionStorage } from '../telegram/conversation-session-store.js';
import { createAppMetadataWelcomeTemplateStore, renderWelcomeTemplate } from './welcome-template-store.js';

test('welcome template store picks user-specific templates before global ones', async () => {
  const storage = createMemoryStorage();
  const store = createAppMetadataWelcomeTemplateStore({ storage });

  await store.saveTemplate({
    id: 'global',
    templateText: 'Ya esta aqui $USERNAME',
    isEnabled: true,
    sortOrder: 0,
  });
  await store.saveTemplate({
    id: 'david',
    templateText: 'Ahora $USERNAME ya viene rodando',
    targetTelegramUserId: 42,
    animationFileId: 'gif-file-id',
    isEnabled: true,
    sortOrder: 0,
  });

  assert.equal((await store.pickTemplate({ telegramUserId: 42, random: () => 0 }))?.id, 'david');
  assert.equal((await store.pickTemplate({ telegramUserId: 7, random: () => 0 }))?.id, 'global');
});

test('welcome template store can skip the previously picked template when there are alternatives', async () => {
  const storage = createMemoryStorage();
  const store = createAppMetadataWelcomeTemplateStore({ storage });

  await store.saveTemplate({
    id: 'first',
    templateText: 'Primera $USERNAME',
    isEnabled: true,
    sortOrder: 0,
  });
  await store.saveTemplate({
    id: 'second',
    templateText: 'Segunda $USERNAME',
    isEnabled: true,
    sortOrder: 1,
  });

  assert.equal((await store.pickTemplate({ telegramUserId: 7, excludeTemplateId: 'first', random: () => 0 }))?.id, 'second');
});

test('renderWelcomeTemplate replaces the display-name placeholder', () => {
  assert.equal(renderWelcomeTemplate('Ya llego $USERNAME, y trae pizza', 'Ada'), 'Ya llego Ada, y trae pizza');
});

function createMemoryStorage(): AppMetadataSessionStorage {
  const values = new Map<string, string>();
  return {
    async get(key) {
      return values.get(key) ?? null;
    },
    async set(key, value) {
      values.set(key, value);
    },
    async delete(key) {
      return values.delete(key);
    },
    async listByPrefix(prefix) {
      return Array.from(values.entries())
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, value }));
    },
  };
}
