import type { AppMetadataSessionStorage } from '../telegram/conversation-session-store.js';

const autoSchedulingEnabledKey = 'role-games.auto-scheduling.enabled';

export interface RoleGameAutoSchedulingStore {
  isEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<void>;
}

export function createAppMetadataRoleGameAutoSchedulingStore({
  storage,
}: {
  storage: AppMetadataSessionStorage;
}): RoleGameAutoSchedulingStore {
  return {
    async isEnabled() {
      return (await storage.get(autoSchedulingEnabledKey)) === 'true';
    },
    async setEnabled(enabled) {
      if (enabled) {
        await storage.set(autoSchedulingEnabledKey, 'true');
        return;
      }
      await storage.delete(autoSchedulingEnabledKey);
    },
  };
}
