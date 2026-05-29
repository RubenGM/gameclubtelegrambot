import type { AppMetadataSessionStorage } from '../telegram/conversation-session-store.js';

const autojoinPrefix = 'telegram.membership-autojoin:';
const enabledValue = 'true';

export interface MembershipAutojoinStore {
  isEnabled(chatId: number): Promise<boolean>;
  setEnabled(chatId: number, isEnabled: boolean): Promise<void>;
}

export function createAppMetadataMembershipAutojoinStore({
  storage,
}: {
  storage: AppMetadataSessionStorage;
}): MembershipAutojoinStore {
  return {
    async isEnabled(chatId) {
      return (await storage.get(buildAutojoinKey(chatId))) === enabledValue;
    },
    async setEnabled(chatId, isEnabled) {
      const key = buildAutojoinKey(chatId);

      if (isEnabled) {
        await storage.set(key, enabledValue);
        return;
      }

      await storage.delete(key);
    },
  };
}

export async function toggleMembershipAutojoin({
  store,
  chatId,
  enabled,
}: {
  store: MembershipAutojoinStore;
  chatId: number;
  enabled: boolean;
}): Promise<'enabled' | 'disabled' | 'already-enabled' | 'already-disabled'> {
  const currentlyEnabled = await store.isEnabled(chatId);

  if (enabled) {
    if (currentlyEnabled) {
      return 'already-enabled';
    }

    await store.setEnabled(chatId, true);
    return 'enabled';
  }

  if (!currentlyEnabled) {
    return 'already-disabled';
  }

  await store.setEnabled(chatId, false);
  return 'disabled';
}

function buildAutojoinKey(chatId: number): string {
  return `${autojoinPrefix}${chatId}`;
}
