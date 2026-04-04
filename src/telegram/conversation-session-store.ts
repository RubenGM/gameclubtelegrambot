import { eq, like, sql } from 'drizzle-orm';

import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { appMetadata } from '../infrastructure/database/schema.js';
import type { ConversationSessionRecord, ConversationSessionStore } from './conversation-session.js';

export interface AppMetadataSessionStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<boolean>;
  listByPrefix(prefix: string): Promise<Array<{ key: string; value: string }>>;
}

const conversationSessionPrefix = 'telegram.session:';

export function createAppMetadataConversationSessionStore({
  storage,
}: {
  storage: AppMetadataSessionStorage;
}): ConversationSessionStore {
  return {
    async loadSession(key) {
      const raw = await storage.get(key);
      return raw ? parseConversationSessionRecord(raw) : null;
    },
    async saveSession(session) {
      await storage.set(session.key, JSON.stringify(session));
    },
    async deleteSession(key) {
      return storage.delete(key);
    },
    async deleteExpiredSessions(nowIso) {
      const rows = await storage.listByPrefix(conversationSessionPrefix);
      let deleted = 0;

      for (const row of rows) {
        const session = parseConversationSessionRecord(row.value);

        if (session.expiresAt <= nowIso) {
          const removed = await storage.delete(row.key);
          if (removed) {
            deleted += 1;
          }
        }
      }

      return deleted;
    },
  };
}

export function createDatabaseAppMetadataSessionStorage({
  database,
}: {
  database: DatabaseConnection['db'];
}): AppMetadataSessionStorage {
  return {
    async get(key) {
      const result = await database
        .select({ value: appMetadata.value })
        .from(appMetadata)
        .where(eq(appMetadata.key, key));

      return result[0]?.value ?? null;
    },
    async set(key, value) {
      await database
        .insert(appMetadata)
        .values({
          key,
          value,
        })
        .onConflictDoUpdate({
          target: appMetadata.key,
          set: {
            value,
            updatedAt: sql`now()`,
          },
        });
    },
    async delete(key) {
      const deleted = await database
        .delete(appMetadata)
        .where(eq(appMetadata.key, key))
        .returning({ key: appMetadata.key });

      return deleted.length > 0;
    },
    async listByPrefix(prefix) {
      return database
        .select({ key: appMetadata.key, value: appMetadata.value })
        .from(appMetadata)
        .where(like(appMetadata.key, `${prefix}%`));
    },
  };
}

function parseConversationSessionRecord(raw: string): ConversationSessionRecord {
  const parsed: unknown = JSON.parse(raw);

  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'key' in parsed &&
    'flowKey' in parsed &&
    'stepKey' in parsed &&
    'data' in parsed &&
    'createdAt' in parsed &&
    'updatedAt' in parsed &&
    'expiresAt' in parsed &&
    typeof parsed.key === 'string' &&
    typeof parsed.flowKey === 'string' &&
    typeof parsed.stepKey === 'string' &&
    typeof parsed.createdAt === 'string' &&
    typeof parsed.updatedAt === 'string' &&
    typeof parsed.expiresAt === 'string' &&
    typeof parsed.data === 'object' &&
    parsed.data !== null
  ) {
    return {
      key: parsed.key,
      flowKey: parsed.flowKey,
      stepKey: parsed.stepKey,
      data: parsed.data as Record<string, unknown>,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
      expiresAt: parsed.expiresAt,
    };
  }

  throw new Error('Stored conversation session contains invalid JSON payload');
}
