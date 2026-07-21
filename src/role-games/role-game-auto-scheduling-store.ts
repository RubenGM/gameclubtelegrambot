import type { AppMetadataSessionStorage } from '../telegram/conversation-session-store.js';

const autoSchedulingEnabledKey = 'role-games.auto-scheduling.enabled';
const autoSchedulingMaxFutureWeeksKey = 'role-games.auto-scheduling.max-future-weeks';

export const defaultRoleGameAutoSchedulingMaxFutureWeeks = 2;
export const minRoleGameAutoSchedulingMaxFutureWeeks = 1;
export const maxRoleGameAutoSchedulingMaxFutureWeeks = 52;

export interface RoleGameAutoSchedulingSettings {
  enabled: boolean;
  maxFutureWeeks: number;
}

export interface RoleGameAutoSchedulingStore {
  getSettings(): Promise<RoleGameAutoSchedulingSettings>;
  isEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<void>;
  setMaxFutureWeeks(maxFutureWeeks: number): Promise<void>;
}

export function createAppMetadataRoleGameAutoSchedulingStore({
  storage,
}: {
  storage: AppMetadataSessionStorage;
}): RoleGameAutoSchedulingStore {
  const isEnabled = async () => (await storage.get(autoSchedulingEnabledKey)) === 'true';
  const getMaxFutureWeeks = async () => parseStoredMaxFutureWeeks(
    await storage.get(autoSchedulingMaxFutureWeeksKey),
  );

  return {
    async getSettings() {
      const [enabled, maxFutureWeeks] = await Promise.all([
        isEnabled(),
        getMaxFutureWeeks(),
      ]);
      return { enabled, maxFutureWeeks };
    },
    isEnabled,
    async setEnabled(enabled) {
      if (enabled) {
        await storage.set(autoSchedulingEnabledKey, 'true');
        return;
      }
      await storage.delete(autoSchedulingEnabledKey);
    },
    async setMaxFutureWeeks(maxFutureWeeks) {
      assertValidMaxFutureWeeks(maxFutureWeeks);
      if (maxFutureWeeks === defaultRoleGameAutoSchedulingMaxFutureWeeks) {
        await storage.delete(autoSchedulingMaxFutureWeeksKey);
        return;
      }
      await storage.set(autoSchedulingMaxFutureWeeksKey, String(maxFutureWeeks));
    },
  };
}

function parseStoredMaxFutureWeeks(value: string | null): number {
  if (value === null) {
    return defaultRoleGameAutoSchedulingMaxFutureWeeks;
  }
  const parsed = Number(value);
  if (
    !Number.isInteger(parsed)
    || parsed < minRoleGameAutoSchedulingMaxFutureWeeks
    || parsed > maxRoleGameAutoSchedulingMaxFutureWeeks
  ) {
    return defaultRoleGameAutoSchedulingMaxFutureWeeks;
  }
  return parsed;
}

function assertValidMaxFutureWeeks(maxFutureWeeks: number): void {
  if (
    !Number.isInteger(maxFutureWeeks)
    || maxFutureWeeks < minRoleGameAutoSchedulingMaxFutureWeeks
    || maxFutureWeeks > maxRoleGameAutoSchedulingMaxFutureWeeks
  ) {
    throw new RangeError(
      `Role game automatic scheduling horizon must be an integer between ${minRoleGameAutoSchedulingMaxFutureWeeks} and ${maxRoleGameAutoSchedulingMaxFutureWeeks} weeks`,
    );
  }
}
