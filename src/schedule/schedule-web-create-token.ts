import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { appMetadata } from '../infrastructure/database/schema.js';
import type { AppMetadataSessionStorage } from '../telegram/conversation-session-store.js';

export interface ScheduleWebCreateTokenRecord {
  telegramUserId: number;
  sessionKey: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface ScheduleWebCreateTokenStore {
  issue(input: {
    telegramUserId: number;
    sessionKey?: string | null;
  }): Promise<{ token: string; record: ScheduleWebCreateTokenRecord }>;
  inspect(token: string): Promise<ScheduleWebCreateTokenRecord | null>;
  consume(token: string): Promise<ScheduleWebCreateTokenRecord | null>;
  restore(token: string, record: ScheduleWebCreateTokenRecord): Promise<void>;
}

interface AtomicTokenStorage extends AppMetadataSessionStorage {
  take?(key: string): Promise<string | null>;
}

const tokenKeyPrefix = 'schedule.web_create.token:';
const tokenTtlMs = 30 * 60 * 1000;

export function createScheduleWebCreateTokenStore({
  storage,
  now = () => new Date(),
  generateToken = () => randomBytes(32).toString('base64url'),
}: {
  storage: AtomicTokenStorage;
  now?: () => Date;
  generateToken?: () => string;
}): ScheduleWebCreateTokenStore {
  return {
    async issue({ telegramUserId, sessionKey = null }) {
      if (!Number.isInteger(telegramUserId) || telegramUserId <= 0) {
        throw new Error('El usuario de Telegram no es válido.');
      }
      const token = generateToken();
      if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) {
        throw new Error('No se ha podido generar un token seguro.');
      }
      const createdAt = now();
      const record: ScheduleWebCreateTokenRecord = {
        telegramUserId,
        sessionKey: normalizeSessionKey(sessionKey),
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + tokenTtlMs).toISOString(),
      };
      await storage.set(tokenStorageKey(token), JSON.stringify(record));
      return { token, record };
    },
    async inspect(token) {
      if (!isTokenShapeValid(token)) {
        return null;
      }
      const raw = await storage.get(tokenStorageKey(token));
      const record = parseTokenRecord(raw);
      if (!record) {
        return null;
      }
      if (new Date(record.expiresAt).getTime() <= now().getTime()) {
        await storage.delete(tokenStorageKey(token));
        return null;
      }
      return record;
    },
    async consume(token) {
      if (!isTokenShapeValid(token)) {
        return null;
      }
      const key = tokenStorageKey(token);
      const raw = storage.take
        ? await storage.take(key)
        : await takeFallback(storage, key);
      const record = parseTokenRecord(raw);
      if (!record || new Date(record.expiresAt).getTime() <= now().getTime()) {
        return null;
      }
      return record;
    },
    async restore(token, record) {
      if (!isTokenShapeValid(token) || !parseTokenRecord(JSON.stringify(record))) {
        throw new Error('No se puede restaurar un token de creación inválido.');
      }
      await storage.set(tokenStorageKey(token), JSON.stringify(record));
    },
  };
}

export function createDatabaseScheduleWebCreateTokenStore({
  database,
}: {
  database: DatabaseConnection['db'];
}): ScheduleWebCreateTokenStore {
  const storage: AtomicTokenStorage = {
    async get(key) {
      const rows = await database
        .select({ value: appMetadata.value })
        .from(appMetadata)
        .where(eq(appMetadata.key, key));
      return rows[0]?.value ?? null;
    },
    async set(key, value) {
      await database
        .insert(appMetadata)
        .values({ key, value })
        .onConflictDoUpdate({
          target: appMetadata.key,
          set: { value, updatedAt: new Date() },
        });
    },
    async delete(key) {
      const rows = await database
        .delete(appMetadata)
        .where(eq(appMetadata.key, key))
        .returning({ key: appMetadata.key });
      return rows.length > 0;
    },
    async listByPrefix() {
      return [];
    },
    async take(key) {
      const rows = await database
        .delete(appMetadata)
        .where(eq(appMetadata.key, key))
        .returning({ value: appMetadata.value });
      return rows[0]?.value ?? null;
    },
  };
  return createScheduleWebCreateTokenStore({ storage });
}

function tokenStorageKey(token: string): string {
  return `${tokenKeyPrefix}${createHash('sha256').update(token).digest('hex')}`;
}

function isTokenShapeValid(token: string): boolean {
  return /^[A-Za-z0-9_-]{32,128}$/.test(token);
}

async function takeFallback(storage: AtomicTokenStorage, key: string): Promise<string | null> {
  const raw = await storage.get(key);
  if (!raw) {
    return null;
  }
  return await storage.delete(key) ? raw : null;
}

function parseTokenRecord(raw: string | null): ScheduleWebCreateTokenRecord | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ScheduleWebCreateTokenRecord>;
    if (
      !Number.isInteger(parsed.telegramUserId)
      || Number(parsed.telegramUserId) <= 0
      || typeof parsed.createdAt !== 'string'
      || typeof parsed.expiresAt !== 'string'
      || Number.isNaN(new Date(parsed.createdAt).getTime())
      || Number.isNaN(new Date(parsed.expiresAt).getTime())
    ) {
      return null;
    }
    return {
      telegramUserId: Number(parsed.telegramUserId),
      sessionKey: normalizeSessionKey(parsed.sessionKey),
      createdAt: parsed.createdAt,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

function normalizeSessionKey(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (
    typeof value !== 'string'
    || !/^telegram\.session:-?\d+:\d+$/.test(value)
    || value.length > 128
  ) {
    throw new Error('La sesión de Telegram vinculada no es válida.');
  }
  return value;
}
