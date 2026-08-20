import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { appMetadata } from '../infrastructure/database/schema.js';
import type { AppMetadataSessionStorage } from '../telegram/conversation-session-store.js';

export interface CatalogWebAdminTokenRecord {
  telegramUserId: number;
  createdAt: string;
  expiresAt: string;
}

export interface CatalogWebAdminTokenStore {
  issue(input: { telegramUserId: number }): Promise<{ token: string; record: CatalogWebAdminTokenRecord }>;
  inspect(token: string): Promise<CatalogWebAdminTokenRecord | null>;
}

const tokenKeyPrefix = 'catalog.web_admin.token:';
const tokenTtlMs = 60 * 60 * 1000;

export function createCatalogWebAdminTokenStore({
  storage,
  now = () => new Date(),
  generateToken = () => randomBytes(32).toString('base64url'),
}: {
  storage: AppMetadataSessionStorage;
  now?: () => Date;
  generateToken?: () => string;
}): CatalogWebAdminTokenStore {
  return {
    async issue({ telegramUserId }) {
      if (!Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) {
        throw new Error('El administrador de Telegram no es válido.');
      }
      const token = generateToken();
      if (!isTokenShapeValid(token)) {
        throw new Error('No se ha podido generar un token seguro.');
      }
      const createdAt = now();
      const record: CatalogWebAdminTokenRecord = {
        telegramUserId,
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + tokenTtlMs).toISOString(),
      };
      await storage.set(tokenStorageKey(token), JSON.stringify(record));
      return { token, record };
    },
    async inspect(token) {
      if (!isTokenShapeValid(token)) return null;
      const key = tokenStorageKey(token);
      const record = parseTokenRecord(await storage.get(key));
      if (!record) return null;
      if (new Date(record.expiresAt).getTime() <= now().getTime()) {
        await storage.delete(key);
        return null;
      }
      return record;
    },
  };
}

export function createDatabaseCatalogWebAdminTokenStore({ database }: { database: DatabaseConnection['db'] }): CatalogWebAdminTokenStore {
  const storage: AppMetadataSessionStorage = {
    async get(key) {
      const rows = await database.select({ value: appMetadata.value }).from(appMetadata).where(eq(appMetadata.key, key));
      return rows[0]?.value ?? null;
    },
    async set(key, value) {
      await database.insert(appMetadata).values({ key, value }).onConflictDoUpdate({
        target: appMetadata.key,
        set: { value, updatedAt: new Date() },
      });
    },
    async delete(key) {
      const rows = await database.delete(appMetadata).where(eq(appMetadata.key, key)).returning({ key: appMetadata.key });
      return rows.length > 0;
    },
    async listByPrefix() { return []; },
  };
  return createCatalogWebAdminTokenStore({ storage });
}

function tokenStorageKey(token: string): string {
  return `${tokenKeyPrefix}${createHash('sha256').update(token).digest('hex')}`;
}

function isTokenShapeValid(token: string): boolean {
  return /^[A-Za-z0-9_-]{32,128}$/.test(token);
}

function parseTokenRecord(raw: string | null): CatalogWebAdminTokenRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CatalogWebAdminTokenRecord>;
    if (!Number.isSafeInteger(parsed.telegramUserId) || Number(parsed.telegramUserId) <= 0
      || typeof parsed.createdAt !== 'string' || typeof parsed.expiresAt !== 'string'
      || Number.isNaN(Date.parse(parsed.createdAt)) || Number.isNaN(Date.parse(parsed.expiresAt))) return null;
    return { telegramUserId: Number(parsed.telegramUserId), createdAt: parsed.createdAt, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}
