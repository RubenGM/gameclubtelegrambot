import type { StorageCategoryPurpose } from './storage-catalog.js';

export const internalRoleGameHandoutPurpose = 'role_game_handouts' satisfies StorageCategoryPurpose;

export function isUserVisibleStorageCategoryPurpose(purpose: StorageCategoryPurpose): boolean {
  return purpose === 'user_uploads';
}
